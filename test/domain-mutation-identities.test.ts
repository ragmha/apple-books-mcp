import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  addBookToCollectionTx,
  deleteCollectionTx,
  removeBookFromCollectionTx,
} from "../src/db/collections.ts";
import { Tables } from "../src/db/constants.ts";
import { createLibraryMutation } from "../src/db/library-mutation.ts";
import { FakeBooksAppPort, FakeLibraryStore } from "./helpers/fakes.ts";
import { createSeededDb, seedBook, seedCollection } from "./helpers/seed.ts";

let db: Database;
afterEach(() => db.close());

const naturalIds = [
  "14",
  "0014",
  "0",
  "-14",
  "9007199254740993",
  "14' or 1=1 --",
];

function fixture(naturalId: string) {
  db = createSeededDb();
  for (const [pk, id] of [
    [14, "unrelated"],
    [99, naturalId],
  ] as const) {
    seedBook(db, { pk, assetId: id, title: `Book ${pk}` });
    seedCollection(db, { pk, uuid: id, title: `Collection ${pk}` });
  }
  return createLibraryMutation(
    new FakeLibraryStore(db),
    new FakeBooksAppPort(),
  );
}

describe("collection mutation identity precedence", () => {
  test.each(
    naturalIds,
  )("add prefers exact natural key %s over either entity's PK", async (id) => {
    const mutation = fixture(id);
    const result = await mutation.mutate((tx) =>
      addBookToCollectionTx(tx, id, id),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ bookPk: 99, collectionPk: 99 });
    }
    expect(
      db
        .query<{ ZASSET: number; ZCOLLECTION: number; ZASSETID: string }, []>(
          `SELECT ZASSET, ZCOLLECTION, ZASSETID FROM ${Tables.CollectionMembers}`,
        )
        .all(),
    ).toEqual([{ ZASSET: 99, ZCOLLECTION: 99, ZASSETID: id }]);
  });

  test.each(
    naturalIds,
  )("remove prefers exact natural key %s and preserves the other membership", async (id) => {
    const mutation = fixture(id);
    for (const pk of [14, 99]) {
      db.run(
        `INSERT INTO ${Tables.CollectionMembers} (Z_PK, ZASSET, ZCOLLECTION) VALUES (?, ?, ?)`,
        [pk, pk, pk],
      );
    }

    const result = await mutation.mutate((tx) =>
      removeBookFromCollectionTx(tx, id, id),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ bookPk: 99, collectionPk: 99 });
    }
    expect(
      db
        .query<{ ZASSET: number; ZCOLLECTION: number }, []>(
          `SELECT ZASSET, ZCOLLECTION FROM ${Tables.CollectionMembers}`,
        )
        .all(),
    ).toEqual([{ ZASSET: 14, ZCOLLECTION: 14 }]);
  });

  test.each([
    ...naturalIds,
    "14F00000-0000-4000-8000-000000000099",
  ])("delete resolves %s without touching a numeric-prefix collision", async (id) => {
    const mutation = fixture(id);
    const result = await mutation.mutate((tx) =>
      deleteCollectionTx(tx, id.toLowerCase()),
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.collectionPk).toBe(99);
    expect(
      db
        .query<{ Z_PK: number; ZDELETEDFLAG: number; Z_OPT: number }, []>(
          `SELECT Z_PK, ZDELETEDFLAG, Z_OPT FROM ${Tables.Collections} ORDER BY Z_PK`,
        )
        .all(),
    ).toEqual([
      { Z_PK: 14, ZDELETEDFLAG: 0, Z_OPT: 1 },
      { Z_PK: 99, ZDELETEDFLAG: 1, Z_OPT: 2 },
    ]);
  });
});
