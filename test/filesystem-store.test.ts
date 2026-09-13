import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createLibraryMutation } from "../src/db/library-mutation.ts";
import { FakeBooksAppPort } from "./helpers/fakes.ts";
import { filesystemFixture } from "./helpers/filesystem-store.ts";

describe("filesystem storage", () => {
  test("a frozen clock still produces distinct snapshots and keeps the five newest", () => {
    const fixture = filesystemFixture("library", () => 1_800_000_000_000);
    try {
      const live = fixture.openWritable();
      live.run("CREATE TABLE snapshot_probe (value INTEGER)");
      const handles: string[] = [];
      for (let i = 0; i < 6; i++) {
        live.run("INSERT INTO snapshot_probe VALUES (?)", [i]);
        handles.push(fixture.store.snapshot());
      }
      expect(new Set(handles).size).toBe(6);
      expect(
        fixture.store.listBackups().map((backup) => backup.handle),
      ).toEqual(handles.slice(1).reverse());
      for (const [index, handle] of handles.entries()) {
        if (index === 0) {
          expect(existsSync(handle)).toBe(false);
          continue;
        }
        const snapshot = new Database(handle, { readonly: true });
        try {
          expect(
            snapshot
              .query("SELECT COUNT(*) AS count FROM snapshot_probe")
              .get(),
          ).toEqual({ count: index + 1 });
        } finally {
          snapshot.close();
        }
      }
    } finally {
      fixture.cleanup();
    }
  });

  describe("filesystem restores", () => {
    for (const kind of ["library", "annotation"] as const) {
      test(`${kind}: restores the oldest of five backups without pruning the target`, async () => {
        const fixture = filesystemFixture(kind, () => 1_800_000_000_000);
        try {
          const live = fixture.openWritable();
          live.run("CREATE TABLE restore_probe (value INTEGER)");
          const handles: string[] = [];
          for (let i = 0; i < 5; i++) {
            live.run("INSERT INTO restore_probe VALUES (?)", [i]);
            handles.push(fixture.store.snapshot());
          }
          const target = handles[0];
          if (!target) throw new Error("Missing fixture target");
          const result = await createLibraryMutation(
            fixture.store,
            new FakeBooksAppPort(),
          ).restore(target);
          expect(result.success).toBe(true);
          expect(result.safetyBackupPath).toBeDefined();
          expect(existsSync(target)).toBe(true);
          expect(
            fixture
              .openWritable()
              .query("SELECT value FROM restore_probe")
              .all(),
          ).toEqual([{ value: 0 }]);
          expect(fixture.store.listBackups()).toHaveLength(6);
          fixture.store.snapshot();
          expect(fixture.store.listBackups()).toHaveLength(5);
          expect(existsSync(target)).toBe(false);
          if (!result.safetyBackupPath)
            throw new Error("Missing safety backup");
          expect(existsSync(result.safetyBackupPath)).toBe(true);
        } finally {
          fixture.cleanup();
        }
      });

      test(`${kind}: restore followed by an immediate cached-mode write preserves restored data`, async () => {
        const fixture = filesystemFixture(kind);
        try {
          const live = fixture.openWritable();
          live.run("CREATE TABLE restore_probe (value TEXT)");
          live.run("INSERT INTO restore_probe VALUES ('selected')");
          const target = fixture.store.snapshot();
          live.run("UPDATE restore_probe SET value = 'obsolete cached state'");
          const mutation = createLibraryMutation(
            fixture.store,
            new FakeBooksAppPort(),
          );
          expect((await mutation.restore(target)).success).toBe(true);
          expect(() => live.run("SELECT 1")).toThrow();
          const next = await mutation.mutate((tx) => {
            tx.run("INSERT INTO restore_probe VALUES ('next write')");
          });
          expect(next.success).toBe(true);
          expect(
            fixture
              .openWritable()
              .query("SELECT value FROM restore_probe")
              .all(),
          ).toEqual([{ value: "selected" }, { value: "next write" }]);
        } finally {
          fixture.cleanup();
        }
      });
    }
  });

  for (const kind of ["library", "annotation"] as const) {
    test(`${kind}: a WAL snapshot verifies read-only without sidecars`, () => {
      const fixture = filesystemFixture(kind);
      try {
        const handle = fixture.store.snapshot();
        expect(fixture.store.verifySnapshot(handle)).toBe(true);
        const snapshot = new Database(handle, { readonly: true });
        try {
          expect(snapshot.query("PRAGMA integrity_check").get()).toEqual({
            integrity_check: "ok",
          });
        } finally {
          snapshot.close();
        }
        expect(existsSync(`${handle}-wal`)).toBe(false);
        expect(existsSync(`${handle}-shm`)).toBe(false);
      } finally {
        fixture.cleanup();
      }
    });

    test(`${kind}: snapshots include committed WAL frames with an older reader held`, () => {
      const fixture = filesystemFixture(kind);
      let reader: Database | undefined;
      try {
        const live = fixture.openWritable();
        live.run("CREATE TABLE snapshot_probe (value TEXT)");
        live.run("INSERT INTO snapshot_probe VALUES ('before')");
        live.run("PRAGMA wal_checkpoint(TRUNCATE)");
        reader = new Database(fixture.dbPath, { readonly: true });
        reader.run("BEGIN");
        expect(reader.query("SELECT value FROM snapshot_probe").all()).toEqual([
          { value: "before" },
        ]);
        live.run("INSERT INTO snapshot_probe VALUES ('committed in WAL')");
        expect(
          live.query("PRAGMA wal_checkpoint(TRUNCATE)").get(),
        ).toMatchObject({
          busy: 1,
        });

        const handle = fixture.store.snapshot();
        const snapshot = new Database(handle, { readonly: true });
        try {
          expect(
            snapshot.query("SELECT value FROM snapshot_probe").all(),
          ).toEqual([{ value: "before" }, { value: "committed in WAL" }]);
        } finally {
          snapshot.close();
        }
      } finally {
        reader?.close();
        fixture.cleanup();
      }
    });

    test(`${kind}: a snapshot excludes a competing writer's uncommitted WAL rows`, () => {
      const fixture = filesystemFixture(kind);
      let writer: Database | undefined;
      try {
        const live = fixture.openWritable();
        live.run("CREATE TABLE isolation_probe (value TEXT)");
        live.run("INSERT INTO isolation_probe VALUES ('committed')");
        writer = new Database(fixture.dbPath);
        writer.run("BEGIN IMMEDIATE");
        writer.run("INSERT INTO isolation_probe VALUES ('not committed')");
        const target = fixture.store.snapshot();
        const snapshot = new Database(target, { readonly: true });
        try {
          expect(
            snapshot.query("SELECT value FROM isolation_probe").all(),
          ).toEqual([{ value: "committed" }]);
        } finally {
          snapshot.close();
        }
        expect(
          writer.query("SELECT COUNT(*) AS count FROM isolation_probe").get(),
        ).toEqual({ count: 2 });
      } finally {
        writer?.close();
        fixture.cleanup();
      }
    });
  }
});

test("both store lifecycles serialize on their shared BooksAppPort", async () => {
  const library = filesystemFixture("library");
  const annotations = filesystemFixture("annotation");
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const books = new FakeBooksAppPort();
  const originalIsRunning = books.isRunning.bind(books);
  let checks = 0;
  books.isRunning = async () => {
    checks++;
    if (checks === 1) {
      entered();
      await gate;
    }
    return originalIsRunning();
  };
  try {
    const first = createLibraryMutation(library.store, books).mutate(
      () => "library",
    );
    await started;
    const second = createLibraryMutation(annotations.store, books).mutate(
      () => "annotations",
    );
    await Promise.resolve();
    expect(annotations.store.listBackups()).toHaveLength(0);
    expect(checks).toBe(1);
    release();
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.success)).toEqual([true, true]);
    expect(books.calls).toEqual([
      "isRunning",
      "launch",
      "isRunning",
      "quit",
      "launch",
    ]);
  } finally {
    release();
    library.cleanup();
    annotations.cleanup();
  }
});

test("the real store restores fixture paths containing quotes, spaces, and URI delimiters", async () => {
  const fixture = filesystemFixture(
    "library",
    undefined,
    {},
    "books \u00e9 \"double\" 'single' \\ #?% fixture-",
  );
  try {
    const live = fixture.openWritable();
    live.run("CREATE TABLE quoting_probe (value TEXT)");
    live.run("INSERT INTO quoting_probe VALUES ('selected')");
    const target = fixture.store.snapshot();
    live.run("UPDATE quoting_probe SET value = 'current'");
    const result = await createLibraryMutation(
      fixture.store,
      new FakeBooksAppPort(),
    ).restore(target);
    expect(result.success).toBe(true);
    expect(
      fixture.openWritable().query("SELECT value FROM quoting_probe").get(),
    ).toEqual({ value: "selected" });
  } finally {
    fixture.cleanup();
  }
});
