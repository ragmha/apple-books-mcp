import { describe, expect, test } from "bun:test";
import { EntityTypes, Tables } from "../src/db/constants.ts";
import {
  createLibraryMutation,
  MutationError,
} from "../src/db/library-mutation.ts";
import { FakeBooksAppPort, FakeLibraryStore } from "./helpers/fakes.ts";
import { createSeededDb } from "./helpers/seed.ts";

describe("LibraryMutation.mutate", () => {
  test("invokes the callback inside a transaction and returns success", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.mutate(() => 42);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(42);
      expect(result.backupPath).toBe("fake-snapshot-1");
    }
  });

  test("rolls back when the callback throws", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    await mutation.mutate((tx) => {
      tx.run(
        `INSERT INTO ${Tables.Collections} (Z_PK, Z_ENT, Z_OPT, ZTITLE) VALUES (?, ?, ?, ?)`,
        [1, 2, 1, "should not survive"],
      );
      throw new Error("boom");
    });

    const rows = db.query(`SELECT * FROM ${Tables.Collections}`).all();
    expect(rows).toEqual([]);
  });

  test("MutationError surfaces its message verbatim (no Operation failed wrapper)", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.mutate(() => {
      throw new MutationError("Book not found: abc-123");
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe("Book not found: abc-123");
  });

  test("system errors return a sanitised message and the backup path (no PII)", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.mutate(() => {
      // Pretend a SQLite error containing user PII bubbles up.
      throw new TypeError("constraint failed on title='User Private Note'");
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/operation failed/i);
    expect(result.message).not.toContain("User Private Note");
    expect(result.backupPath).toBe("fake-snapshot-1");
  });

  test("snapshots and verifies the backup before invoking the callback", async () => {
    const db = createSeededDb();
    const calls: string[] = [];
    const store = new FakeLibraryStore(db, calls);
    const books = new FakeBooksAppPort({ callLog: calls });
    const mutation = createLibraryMutation(store, books);

    await mutation.mutate(() => {
      calls.push("callback");
    });

    // Snapshot + verify both happened, both before the callback ran.
    expect(calls).toContain("snapshot");
    expect(calls).toContain("verify:fake-snapshot-1");
    expect(calls).toContain("callback");
    expect(calls.indexOf("snapshot")).toBeLessThan(calls.indexOf("callback"));
    expect(calls.indexOf("verify:fake-snapshot-1")).toBeLessThan(
      calls.indexOf("callback"),
    );
    expect(store.snapshotsTaken).toBe(1);
  });

  test("aborts without touching the DB when the backup fails verification", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    store.verifyResult = false;
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    let callbackInvoked = false;
    const result = await mutation.mutate((tx) => {
      callbackInvoked = true;
      tx.run(
        `INSERT INTO ${Tables.Collections} (Z_PK, Z_ENT, Z_OPT, ZTITLE) VALUES (1, 2, 1, 'x')`,
      );
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/integrity/i);
    expect(callbackInvoked).toBe(false);
    expect(db.query(`SELECT * FROM ${Tables.Collections}`).all()).toEqual([]);
  });

  test("quits Books.app before invoking the callback when it is running", async () => {
    const db = createSeededDb();
    const calls: string[] = [];
    const store = new FakeLibraryStore(db, calls);
    const books = new FakeBooksAppPort({ running: true, callLog: calls });
    const mutation = createLibraryMutation(store, books);

    await mutation.mutate(() => {
      calls.push("callback");
    });

    expect(calls).toContain("quit");
    expect(calls.indexOf("quit")).toBeLessThan(calls.indexOf("callback"));
  });

  test("does not quit Books.app when it is already not running", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort({ running: false });
    const mutation = createLibraryMutation(store, books);

    await mutation.mutate(() => undefined);

    expect(books.calls).not.toContain("quit");
  });

  test("launches Books.app after a successful COMMIT", async () => {
    const db = createSeededDb();
    const calls: string[] = [];
    const store = new FakeLibraryStore(db, calls);
    const books = new FakeBooksAppPort({ callLog: calls });
    const mutation = createLibraryMutation(store, books);

    await mutation.mutate(() => {
      calls.push("callback");
    });

    expect(calls).toContain("launch");
    expect(calls.indexOf("callback")).toBeLessThan(calls.indexOf("launch"));
  });

  test("does not launch Books.app after a failed mutation", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    await mutation.mutate(() => {
      throw new MutationError("nope");
    });

    expect(books.calls).not.toContain("launch");
  });

  test("skipRestart suppresses the launch even on success", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    await mutation.mutate(() => undefined, { skipRestart: true });

    expect(books.calls).not.toContain("launch");
  });
});

/**
 * Failure-mode tests for system-error paths. The reviewer's findings:
 * launch() failing after COMMIT, ROLLBACK throwing, and setup-step failures
 * must all return a structured MutationResult — never reject the promise,
 * never undo a committed change.
 */
describe("LibraryMutation system-error paths", () => {
  test("launch failure AFTER a successful COMMIT still reports success and persists the change", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    books.launchError = new Error("open -a Books exited with code 1");
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.mutate((tx) => {
      tx.insert(Tables.Collections, EntityTypes.Collection, {
        ZTITLE: "Persisted",
        ZCOLLECTIONID: "uuid-P",
      });
      return "ok";
    });

    // The mutation must report success because the data committed.
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toBe("ok");

    // The row must be on disk.
    const rows = db.query(`SELECT ZTITLE FROM ${Tables.Collections}`).all();
    expect(rows).toEqual([{ ZTITLE: "Persisted" }]);
  });

  test("snapshot failure returns a structured failure (does not reject the promise)", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    store.snapshotError = new Error("disk full");
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    let callbackInvoked = false;
    const result = await mutation.mutate(() => {
      callbackInvoked = true;
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/operation failed/i);
    expect(callbackInvoked).toBe(false);
  });

  test("quit failure returns a structured failure and does NOT touch the DB", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort({ running: true });
    books.quitError = new Error("Books.app failed to quit within 3s");
    const mutation = createLibraryMutation(store, books);

    let callbackInvoked = false;
    const result = await mutation.mutate((tx) => {
      callbackInvoked = true;
      tx.insert(Tables.Collections, EntityTypes.Collection, {
        ZTITLE: "should not exist",
        ZCOLLECTIONID: "uuid-Q",
      });
    });

    expect(result.success).toBe(false);
    expect(callbackInvoked).toBe(false);
    expect(db.query(`SELECT * FROM ${Tables.Collections}`).all()).toEqual([]);
  });
});

describe("LibraryTx (Core Data row helpers)", () => {
  test("insert allocates the next Z_PK by bumping Z_PRIMARYKEY.Z_MAX atomically", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.mutate((tx) => {
      const pk1 = tx.insert(Tables.Collections, EntityTypes.Collection, {
        ZTITLE: "First",
        ZCOLLECTIONID: "uuid-1",
      });
      const pk2 = tx.insert(Tables.Collections, EntityTypes.Collection, {
        ZTITLE: "Second",
        ZCOLLECTIONID: "uuid-2",
      });
      return { pk1, pk2 };
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.pk1).toBe(1);
    expect(result.data.pk2).toBe(2);

    const max = db
      .query<{ Z_MAX: number }, [number]>(
        "SELECT Z_MAX FROM Z_PRIMARYKEY WHERE Z_ENT = ?",
      )
      .get(EntityTypes.Collection);
    expect(max?.Z_MAX).toBe(2);
  });

  test("insert sets Z_ENT, Z_OPT=1, and ZLOCALMODDATE in Core Data epoch seconds", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    const before = Date.now() / 1000 - Date.UTC(2001, 0, 1) / 1000;

    await mutation.mutate((tx) => {
      tx.insert(Tables.Collections, EntityTypes.Collection, {
        ZTITLE: "Discipline",
        ZCOLLECTIONID: "uuid-D",
      });
    });

    const row = db
      .query<
        {
          Z_ENT: number;
          Z_OPT: number;
          ZLOCALMODDATE: number;
          ZTITLE: string;
        },
        []
      >(`SELECT Z_ENT, Z_OPT, ZLOCALMODDATE, ZTITLE FROM ${Tables.Collections}`)
      .get();

    expect(row?.Z_ENT).toBe(EntityTypes.Collection);
    expect(row?.Z_OPT).toBe(1);
    expect(row?.ZTITLE).toBe("Discipline");
    expect(row?.ZLOCALMODDATE).toBeGreaterThanOrEqual(before - 1);
    expect(row?.ZLOCALMODDATE).toBeLessThan(before + 5);
  });

  test("update increments Z_OPT and refreshes ZLOCALMODDATE", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.mutate((tx) => {
      const pk = tx.insert(Tables.Collections, EntityTypes.Collection, {
        ZTITLE: "Original",
        ZCOLLECTIONID: "uuid-U",
        ZLASTMODIFICATION: 0,
      });
      // Force a small gap so the new mtime is observably different.
      const insertedRow = db
        .query<{ ZLOCALMODDATE: number }, [number]>(
          `SELECT ZLOCALMODDATE FROM ${Tables.Collections} WHERE Z_PK = ?`,
        )
        .get(pk);
      if (!insertedRow) {
        throw new Error("Expected inserted collection row");
      }
      const insertedMtime = insertedRow.ZLOCALMODDATE;

      tx.update(Tables.Collections, pk, { ZTITLE: "Renamed" });
      return { pk, insertedMtime };
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const row = db
      .query<
        { Z_OPT: number; ZTITLE: string; ZLOCALMODDATE: number },
        [number]
      >(
        `SELECT Z_OPT, ZTITLE, ZLOCALMODDATE FROM ${Tables.Collections} WHERE Z_PK = ?`,
      )
      .get(result.data.pk);

    expect(row?.Z_OPT).toBe(2);
    expect(row?.ZTITLE).toBe("Renamed");
    expect(row?.ZLOCALMODDATE).toBeGreaterThanOrEqual(
      result.data.insertedMtime,
    );
  });

  test("softDelete sets ZDELETEDFLAG=1, refreshes both mtimes, bumps Z_OPT", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const books = new FakeBooksAppPort();
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.mutate((tx) => {
      const pk = tx.insert(Tables.Collections, EntityTypes.Collection, {
        ZTITLE: "Doomed",
        ZCOLLECTIONID: "uuid-X",
        ZDELETEDFLAG: 0,
        ZLASTMODIFICATION: 0,
      });
      tx.softDelete(Tables.Collections, pk);
      return pk;
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const row = db
      .query<
        {
          ZDELETEDFLAG: number;
          Z_OPT: number;
          ZLASTMODIFICATION: number;
          ZLOCALMODDATE: number;
        },
        [number]
      >(
        `SELECT ZDELETEDFLAG, Z_OPT, ZLASTMODIFICATION, ZLOCALMODDATE FROM ${Tables.Collections} WHERE Z_PK = ?`,
      )
      .get(result.data);

    expect(row?.ZDELETEDFLAG).toBe(1);
    expect(row?.Z_OPT).toBe(2);
    expect(row?.ZLASTMODIFICATION).toBeGreaterThan(0);
    expect(row?.ZLOCALMODDATE).toBeGreaterThan(0);
  });
});
