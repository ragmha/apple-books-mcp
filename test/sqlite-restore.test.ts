import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { openSqliteRestore } from "../src/db/sqlite-restore.ts";
import { filesystemFixture } from "./helpers/filesystem-store.ts";

test("SQLite retains an exclusive lock across snapshots, online restore, and verification", async () => {
  const fixture = filesystemFixture();
  try {
    const live = fixture.openWritable();
    live.run("CREATE TABLE restore_probe (value TEXT)");
    live.run("INSERT INTO restore_probe VALUES ('selected')");
    const target = fixture.store.snapshot();
    live.run("UPDATE restore_probe SET value = 'current'");
    fixture.close();

    const connection = await openSqliteRestore(fixture.dbPath, fixture.dir);
    try {
      const competing = new Database(fixture.dbPath, { readonly: true });
      try {
        expect(() =>
          competing.query("SELECT * FROM restore_probe").all(),
        ).toThrow(/locked/);
      } finally {
        competing.close();
      }

      const safety = join(fixture.dir, "safety \"quoted\" 'space'.sqlite");
      await connection.snapshot(safety);
      const safetyDb = new Database(safety, { readonly: true });
      try {
        expect(safetyDb.query("SELECT value FROM restore_probe").get()).toEqual(
          {
            value: "current",
          },
        );
      } finally {
        safetyDb.close();
      }
      const quotedTarget = join(
        fixture.dir,
        "selected \"double\" 'single' \\ #?%.sqlite",
      );
      copyFileSync(target, quotedTarget);
      await connection.restore(quotedTarget);
      expect(await connection.verify()).toBe(true);
      const competingAfter = new Database(fixture.dbPath);
      try {
        expect(() => competingAfter.run("BEGIN IMMEDIATE")).toThrow(/locked/);
      } finally {
        competingAfter.close();
      }
    } finally {
      await connection.close();
    }

    const restored = new Database(fixture.dbPath);
    try {
      expect(restored.query("SELECT value FROM restore_probe").get()).toEqual({
        value: "selected",
      });
      expect(restored.query("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "wal",
      });
    } finally {
      restored.close();
    }
  } finally {
    fixture.cleanup();
  }
});

for (const kind of ["reader", "writer"] as const) {
  test(`SQLite refuses restore with an external WAL ${kind}, leaving data and journal mode intact`, async () => {
    const fixture = filesystemFixture();
    let external: Database | undefined;
    try {
      fixture.openWritable().run("CREATE TABLE busy_probe (value INTEGER)");
      fixture.close();
      external = new Database(fixture.dbPath);
      external.run(kind === "reader" ? "BEGIN" : "BEGIN IMMEDIATE");
      external.query("SELECT * FROM busy_probe").all();
      const start = performance.now();
      await expect(
        openSqliteRestore(fixture.dbPath, fixture.dir, { busyTimeoutMs: 30 }),
      ).rejects.toThrow(/locked/);
      expect(performance.now() - start).toBeLessThan(2_000);
      expect(external.query("SELECT * FROM busy_probe").all()).toEqual([]);
      external.run("ROLLBACK");
      expect(external.query("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "wal",
      });
    } finally {
      external?.close();
      fixture.cleanup();
    }
  });
}

test("SQLite keeps its exclusive connection usable after a restore error", async () => {
  const fixture = filesystemFixture();
  try {
    fixture.openWritable().run("CREATE TABLE recovery_probe (value INTEGER)");
    fixture.close();
    const connection = await openSqliteRestore(fixture.dbPath, fixture.dir);
    try {
      await expect(
        connection.restore(join(fixture.dir, "missing.sqlite")),
      ).rejects.toThrow(/SQLite restore/);
      expect(await connection.verify()).toBe(true);
      const reader = new Database(fixture.dbPath, { readonly: true });
      try {
        expect(() =>
          reader.query("SELECT * FROM recovery_probe").all(),
        ).toThrow(/locked/);
      } finally {
        reader.close();
      }
    } finally {
      await connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});
