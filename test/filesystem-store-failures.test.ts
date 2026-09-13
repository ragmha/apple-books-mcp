import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../src/db/connection.ts";
import { createLibraryMutation } from "../src/db/library-mutation.ts";
import { openSqliteRestore } from "../src/db/sqlite-restore.ts";
import { FakeBooksAppPort } from "./helpers/fakes.ts";
import { filesystemFixture } from "./helpers/filesystem-store.ts";

for (const kind of ["library", "annotation"] as const) {
  describe(`${kind} real filesystem failures`, () => {
    test("a backup with live WAL sidecars is rejected rather than losing its WAL rows", async () => {
      const fixture = filesystemFixture(kind);
      let backup: Database | undefined;
      try {
        const target = fixture.store.snapshot();
        chmodSync(target, 0o600);
        backup = new Database(target);
        backup.run("PRAGMA journal_mode=WAL");
        backup.run("CREATE TABLE only_in_backup_wal (value TEXT)");
        backup.run(
          "INSERT INTO only_in_backup_wal VALUES ('committed WAL row')",
        );
        expect(existsSync(`${target}-wal`)).toBe(true);
        const books = new FakeBooksAppPort();
        const result = await createLibraryMutation(
          fixture.store,
          books,
        ).restore(target);
        expect(result.success).toBe(false);
        expect(books.calls).toEqual([]);
        expect(
          backup.query("SELECT value FROM only_in_backup_wal").get(),
        ).toEqual({
          value: "committed WAL row",
        });
      } finally {
        backup?.close();
        fixture.cleanup();
      }
    });

    test("invalid handle scope is rejected before database opening or app calls", async () => {
      let opens = 0;
      const fixture = filesystemFixture(kind, undefined, {
        operations: {
          openDatabase(path, readonly) {
            opens++;
            return openDatabase(path, readonly);
          },
        },
      });
      try {
        const target = fixture.store.snapshot();
        const foreign = join(fixture.dir, "not-a-backup.sqlite");
        copyFileSync(target, foreign);
        const before = readdirSync(fixture.dir).sort();
        opens = 0;
        const books = new FakeBooksAppPort();
        const result = await createLibraryMutation(
          fixture.store,
          books,
        ).restore(foreign);
        expect(result.success).toBe(false);
        expect(opens).toBe(0);
        expect(books.calls).toEqual([]);
        expect(readdirSync(fixture.dir).sort()).toEqual(before);
      } finally {
        fixture.cleanup();
      }
    });

    test("symlink and corrupt targets are rejected before app calls", async () => {
      const fixture = filesystemFixture(kind);
      try {
        const target = fixture.store.snapshot();
        const link = `${fixture.dbPath}.backup-1`;
        symlinkSync(target, link);
        const books = new FakeBooksAppPort();
        const mutation = createLibraryMutation(fixture.store, books);
        expect((await mutation.restore(link)).success).toBe(false);
        chmodSync(target, 0o600);
        writeFileSync(target, "corrupt fixture");
        expect((await mutation.restore(target)).success).toBe(false);
        expect(books.calls).toEqual([]);
      } finally {
        fixture.cleanup();
      }
    });

    test("legacy sidecar-free WAL-header backups are normalized privately", () => {
      const fixture = filesystemFixture(kind);
      try {
        const live = fixture.openWritable();
        live.run("PRAGMA wal_checkpoint(TRUNCATE)");
        const legacy = `${fixture.dbPath}.backup-1000`;
        copyFileSync(fixture.dbPath, legacy);
        const before = readFileSync(legacy);
        expect(before[18]).toBe(2);
        expect(fixture.store.verifySnapshot(legacy)).toBe(true);
        expect(readFileSync(legacy)).toEqual(before);
        expect(existsSync(`${legacy}-wal`)).toBe(false);
        expect(existsSync(`${legacy}-shm`)).toBe(false);
        expect(
          fixture.store.listBackups().map((backup) => backup.handle),
        ).toContain(legacy);
      } finally {
        fixture.cleanup();
      }
    });

    test("corrupt fresh safety publication prevents restore and launch", async () => {
      let corrupt = false;
      const fixture = filesystemFixture(kind, undefined, {
        operations: {
          publishFile(source, destination) {
            linkSync(source, destination);
            if (corrupt) {
              chmodSync(destination, 0o600);
              writeFileSync(destination, "corrupt safety fixture");
            }
          },
        },
      });
      try {
        const live = fixture.openWritable();
        live.run("CREATE TABLE safety_probe (value TEXT)");
        live.run("INSERT INTO safety_probe VALUES ('selected')");
        const target = fixture.store.snapshot();
        live.run("UPDATE safety_probe SET value = 'current'");
        corrupt = true;
        const books = new FakeBooksAppPort();
        const result = await createLibraryMutation(
          fixture.store,
          books,
        ).restore(target);
        expect(result.success).toBe(false);
        expect(result.safetyBackupPath).toBeDefined();
        expect(books.calls).not.toContain("launch");
        expect(
          fixture.openWritable().query("SELECT value FROM safety_probe").get(),
        ).toEqual({ value: "current" });
        expect(fixture.store.verifySnapshot(target)).toBe(true);
      } finally {
        fixture.cleanup();
      }
    });

    for (const fault of ["open", "close"] as const) {
      test(`backup ${fault} failure preserves the structured failure contract`, async () => {
        let fail = false;
        const fixture = filesystemFixture(kind, undefined, {
          operations: {
            openDatabase(path, readonly) {
              if (fail && fault === "open") {
                throw new Error("injected backup open failure");
              }
              const db = openDatabase(path, readonly);
              if (fail && fault === "close") {
                const close = db.close.bind(db);
                db.close = () => {
                  close();
                  throw new Error("injected backup close failure");
                };
              }
              return db;
            },
          },
        });
        try {
          const target = fixture.store.snapshot();
          fail = true;
          const books = new FakeBooksAppPort();
          const mutation = createLibraryMutation(fixture.store, books);
          const result = await mutation.restore(target);
          expect(result.success).toBe(false);
          expect(books.calls).toEqual([]);
          let callback = false;
          expect(
            (
              await mutation.mutate(() => {
                callback = true;
              })
            ).success,
          ).toBe(false);
          expect(callback).toBe(false);
          expect(existsSync(target)).toBe(true);
        } finally {
          fixture.cleanup();
        }
      });
    }

    test("a failed backup check is not replaced by a secondary close failure", () => {
      const primary = new Error("primary backup failure");
      const fixture = filesystemFixture(kind, undefined, {
        operations: {
          openDatabase(path, readonly) {
            const db = openDatabase(path, readonly);
            const close = db.close.bind(db);
            db.query = () => {
              throw primary;
            };
            db.close = () => {
              close();
              throw new Error("secondary close failure");
            };
            return db;
          },
        },
      });
      try {
        expect(() => fixture.store.snapshot()).toThrow(primary);
        expect(fixture.store.listBackups()).toEqual([]);
      } finally {
        fixture.cleanup();
      }
    });

    test("publication failure aborts mutation without losing existing backups", async () => {
      let fail = false;
      const fixture = filesystemFixture(kind, undefined, {
        operations: {
          publishFile(source, target) {
            if (fail) throw new Error("injected publish failure");
            linkSync(source, target);
          },
        },
      });
      try {
        const original = fixture.store.snapshot();
        fail = true;
        const books = new FakeBooksAppPort();
        let called = false;
        const result = await createLibraryMutation(fixture.store, books).mutate(
          () => {
            called = true;
          },
        );
        expect(result.success).toBe(false);
        expect(called).toBe(false);
        expect(books.calls).toEqual([]);
        expect(
          fixture.store.listBackups().map((backup) => backup.handle),
        ).toEqual([original]);
      } finally {
        fixture.cleanup();
      }
    });

    test("an exclusive publication collision retries without overwriting the competitor", () => {
      let competitor: string | undefined;
      const fixture = filesystemFixture(kind, () => 1_800_000_000_000, {
        operations: {
          publishFile(source, target) {
            if (!competitor) {
              competitor = target;
              writeFileSync(target, "competing backup", { flag: "wx" });
            }
            linkSync(source, target);
          },
        },
      });
      try {
        const handle = fixture.store.snapshot();
        expect(handle).not.toBe(competitor);
        if (!competitor) throw new Error("No collision injected");
        expect(readFileSync(competitor, "utf8")).toBe("competing backup");
        expect(fixture.store.verifySnapshot(handle)).toBe(true);
      } finally {
        fixture.cleanup();
      }
    });

    for (const failure of ["missing SQLite", "safety snapshot"] as const) {
      test(`${failure} returns failure with no restore or launch`, async () => {
        const fixture = filesystemFixture(kind, undefined, {
          operations: {
            async openRestore(path, dir) {
              if (failure === "missing SQLite") {
                return openSqliteRestore(path, dir, {
                  executable: join(dir, "missing-sqlite"),
                });
              }
              const real = await openSqliteRestore(path, dir);
              return {
                ...real,
                async snapshot() {
                  throw new Error("injected safety snapshot failure");
                },
              };
            },
          },
        });
        try {
          const live = fixture.openWritable();
          live.run("CREATE TABLE setup_probe (value TEXT)");
          live.run("INSERT INTO setup_probe VALUES ('selected')");
          const target = fixture.store.snapshot();
          live.run("UPDATE setup_probe SET value = 'current'");
          const books = new FakeBooksAppPort();
          const result = await createLibraryMutation(
            fixture.store,
            books,
          ).restore(target);
          expect(result.success).toBe(false);
          expect(result.safetyBackupPath).toBeUndefined();
          if (failure === "missing SQLite") {
            expect(result.message).toContain("/usr/bin/sqlite3");
          }
          expect(books.calls).not.toContain("launch");
          expect(fixture.store.listBackups()).toHaveLength(1);
          expect(
            fixture.openWritable().query("SELECT value FROM setup_probe").get(),
          ).toEqual({ value: "current" });
        } finally {
          fixture.cleanup();
        }
      });
    }
    test("pruning failure preserves the verified new backup and mutation outcome", async () => {
      const fixture = filesystemFixture(kind, undefined, {
        operations: {
          removeBackup() {
            throw new Error("injected prune failure");
          },
        },
      });
      try {
        for (let i = 0; i < 5; i++) fixture.store.snapshot();
        const result = await createLibraryMutation(
          fixture.store,
          new FakeBooksAppPort(),
        ).mutate(() => 42);
        expect(result.success).toBe(true);
        if (!result.success)
          throw new Error("Expected committed fixture mutation");
        expect(result.data).toBe(42);
        expect(fixture.store.verifySnapshot(result.backupPath)).toBe(true);
        expect(fixture.store.listBackups()).toHaveLength(6);
      } finally {
        fixture.cleanup();
      }
    });

    for (const externalKind of ["reader", "writer"] as const) {
      test(`restore refuses an external ${externalKind} before taking a safety snapshot`, async () => {
        const fixture = filesystemFixture(kind);
        let external: Database | undefined;
        try {
          const live = fixture.openWritable();
          live.run("CREATE TABLE busy_probe (value TEXT)");
          live.run("INSERT INTO busy_probe VALUES ('selected')");
          const target = fixture.store.snapshot();
          live.run("UPDATE busy_probe SET value = 'current'");
          fixture.close();
          external = new Database(fixture.dbPath);
          external.run(externalKind === "reader" ? "BEGIN" : "BEGIN IMMEDIATE");
          external.query("SELECT * FROM busy_probe").all();
          const books = new FakeBooksAppPort();
          const start = performance.now();
          const result = await createLibraryMutation(
            fixture.store,
            books,
          ).restore(target);
          expect(performance.now() - start).toBeLessThan(2_000);
          expect(result.success).toBe(false);
          expect(result.safetyBackupPath).toBeUndefined();
          expect(books.calls).not.toContain("launch");
          expect(fixture.store.listBackups()).toHaveLength(1);
          expect(external.query("SELECT value FROM busy_probe").get()).toEqual({
            value: "current",
          });
        } finally {
          external?.close();
          fixture.cleanup();
        }
      });
    }
  });
}

for (const fault of [
  "restore",
  "verification",
  "recovery",
  "close",
  "verification and close",
] as const) {
  test(`real restore ${fault} failure retains a recovery handle and does not launch`, async () => {
    const fixture = filesystemFixture("library", undefined, {
      operations: {
        async openRestore(path, dir) {
          const real = await openSqliteRestore(path, dir);
          let restores = 0;
          let verifications = 0;
          return {
            ...real,
            async restore(source) {
              restores++;
              if (
                fault === "restore" ||
                (fault === "recovery" && restores === 2)
              ) {
                throw new Error("injected online restore failure");
              }
              await real.restore(source);
            },
            async verify() {
              verifications++;
              if (
                (fault === "verification" ||
                  fault === "recovery" ||
                  fault === "verification and close") &&
                verifications === 1
              ) {
                return false;
              }
              return real.verify();
            },
            async close() {
              await real.close();
              if (fault === "close" || fault === "verification and close")
                throw new Error("injected lease close failure");
            },
          };
        },
      },
    });
    try {
      const live = fixture.openWritable();
      live.run("CREATE TABLE recovery_probe (value TEXT)");
      live.run("INSERT INTO recovery_probe VALUES ('selected')");
      const target = fixture.store.snapshot();
      live.run("UPDATE recovery_probe SET value = 'current'");
      const books = new FakeBooksAppPort();
      const result = await createLibraryMutation(fixture.store, books).restore(
        target,
      );
      expect(result.success).toBe(false);
      expect(result.safetyBackupPath).toBeDefined();
      expect(books.calls).not.toContain("launch");
      const safety = result.safetyBackupPath;
      if (!safety) throw new Error("Missing safety snapshot");
      expect(fixture.store.verifySnapshot(safety)).toBe(true);
      expect(fixture.store.verifySnapshot(target)).toBe(true);
      const expected =
        fault === "recovery" || fault === "close" ? "selected" : "current";
      expect(
        fixture.openWritable().query("SELECT value FROM recovery_probe").get(),
      ).toEqual({ value: expected });
      if (fault === "verification" || fault === "verification and close")
        expect(result.message).toContain("was recovered");
      if (fault === "recovery")
        expect(result.message).toContain("could not be verified");
      if (fault === "close")
        expect(result.message).toContain("committed and verified");
      for (let i = 0; i < 6; i++) fixture.store.snapshot();
      expect(existsSync(safety)).toBe(true);
      expect(existsSync(target)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });
}
