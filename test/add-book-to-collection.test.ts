import { describe, expect, test } from "bun:test";
import {
  addBookToCollectionTx,
} from "../src/db/collections.ts";
import {
  createLibraryMutation,
  MutationError,
} from "../src/db/library-mutation.ts";
import { Tables } from "../src/db/constants.ts";
import { createSeededDb, seedBook, seedCollection } from "./helpers/seed.ts";
import { FakeBooksAppPort, FakeLibraryStore } from "./helpers/fakes.ts";

describe("addBookToCollection integration", () => {
  test("adds an existing book to an existing collection and bumps the parent collection's mtime", async () => {
    const db = createSeededDb();
    seedBook(db, { pk: 1, assetId: "asset-A", title: "Book A" });
    seedCollection(db, { pk: 1, uuid: "uuid-coll", title: "Favourites" });
    const collMtimeBefore = db
      .query<{ ZLOCALMODDATE: number }, []>(
        `SELECT ZLOCALMODDATE FROM ${Tables.Collections}`,
      )
      .get()!.ZLOCALMODDATE;

    const calls: string[] = [];
    const store = new FakeLibraryStore(db, calls);
    const books = new FakeBooksAppPort({ running: true, callLog: calls });
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.mutate((tx) =>
      addBookToCollectionTx(tx, "asset-A", "uuid-coll"),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    // The join row exists.
    const joins = db
      .query<{ ZASSET: number; ZCOLLECTION: number; ZASSETID: string }, []>(
        `SELECT ZASSET, ZCOLLECTION, ZASSETID FROM ${Tables.CollectionMembers}`,
      )
      .all();
    expect(joins).toEqual([
      { ZASSET: 1, ZCOLLECTION: 1, ZASSETID: "asset-A" },
    ]);

    // Parent collection's mtime was refreshed and Z_OPT bumped.
    const coll = db
      .query<{ Z_OPT: number; ZLOCALMODDATE: number }, []>(
        `SELECT Z_OPT, ZLOCALMODDATE FROM ${Tables.Collections}`,
      )
      .get()!;
    expect(coll.Z_OPT).toBe(2);
    expect(coll.ZLOCALMODDATE).toBeGreaterThan(collMtimeBefore);

    // Books was quit BEFORE the insert, then launched after COMMIT.
    expect(calls).toEqual([
      "snapshot",
      "verify:fake-snapshot-1",
      "isRunning",
      "quit",
      "launch",
    ]);
  });

  test("returns a friendly MutationError when the book does not exist", async () => {
    const db = createSeededDb();
    seedCollection(db, { pk: 1, uuid: "uuid-coll", title: "x" });
    const store = new FakeLibraryStore(db);
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    const result = await mutation.mutate((tx) =>
      addBookToCollectionTx(tx, "missing-asset", "uuid-coll"),
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Book not found: missing-asset");
    expect(db.query(`SELECT * FROM ${Tables.CollectionMembers}`).all()).toEqual(
      [],
    );
  });

  test("refuses a duplicate add with a friendly message", async () => {
    const db = createSeededDb();
    seedBook(db, { pk: 1, assetId: "asset-A", title: "Book A" });
    seedCollection(db, { pk: 1, uuid: "uuid-coll", title: "Favourites" });
    const store = new FakeLibraryStore(db);
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    await mutation.mutate((tx) =>
      addBookToCollectionTx(tx, "asset-A", "uuid-coll"),
    );
    const dup = await mutation.mutate((tx) =>
      addBookToCollectionTx(tx, "asset-A", "uuid-coll"),
    );

    expect(dup.success).toBe(false);
    expect(dup.message).toBe("Book is already in this collection");
    expect(MutationError).toBeDefined();
  });
});
