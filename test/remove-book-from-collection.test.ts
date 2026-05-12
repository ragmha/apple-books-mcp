import { describe, expect, test } from "bun:test";
import {
  removeBookFromCollectionTx,
} from "../src/db/collections.ts";
import { createLibraryMutation } from "../src/db/library-mutation.ts";
import { Tables } from "../src/db/constants.ts";
import { createSeededDb, seedBook, seedCollection } from "./helpers/seed.ts";
import { FakeBooksAppPort, FakeLibraryStore } from "./helpers/fakes.ts";

describe("removeBookFromCollection integration", () => {
  test("removes the join row and refreshes the parent collection's mtime", async () => {
    const db = createSeededDb();
    seedBook(db, { pk: 1, assetId: "asset-A", title: "Book A" });
    seedCollection(db, { pk: 1, uuid: "uuid-coll", title: "Favourites" });
    // Pre-existing membership.
    db.run(
      `INSERT INTO ${Tables.CollectionMembers}
       (Z_PK, Z_ENT, Z_OPT, ZSORTKEY, ZASSET, ZCOLLECTION, ZLOCALMODDATE, ZASSETID)
       VALUES (1, 3, 1, 1, 1, 1, 0, 'asset-A')`,
    );

    const store = new FakeLibraryStore(db);
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    const result = await mutation.mutate((tx) =>
      removeBookFromCollectionTx(tx, "asset-A", "uuid-coll"),
    );

    expect(result.success).toBe(true);
    expect(db.query(`SELECT * FROM ${Tables.CollectionMembers}`).all()).toEqual(
      [],
    );

    const coll = db
      .query<{ Z_OPT: number }, []>(
        `SELECT Z_OPT FROM ${Tables.Collections}`,
      )
      .get()!;
    expect(coll.Z_OPT).toBe(2);
  });

  test("reports 'not in collection' when the join does not exist", async () => {
    const db = createSeededDb();
    seedBook(db, { pk: 1, assetId: "asset-A", title: "x" });
    seedCollection(db, { pk: 1, uuid: "uuid-coll", title: "x" });
    const store = new FakeLibraryStore(db);
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    const result = await mutation.mutate((tx) =>
      removeBookFromCollectionTx(tx, "asset-A", "uuid-coll"),
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Book is not in this collection");
  });
});
