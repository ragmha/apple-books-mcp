import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  deleteAnnotationTx,
  updateAnnotationNoteTx,
} from "../src/db/annotation-mutations.ts";
import {
  addBookToCollectionTx,
  deleteCollectionTx,
  removeBookFromCollectionTx,
} from "../src/db/collections.ts";
import { Tables } from "../src/db/constants.ts";
import {
  createLibraryMutation,
  type LibraryTx,
} from "../src/db/library-mutation.ts";
import { FakeBooksAppPort, FakeLibraryStore } from "./helpers/fakes.ts";
import {
  createSeededAnnotationDb,
  createSeededDb,
  seedAnnotation,
  seedBook,
  seedCollection,
} from "./helpers/seed.ts";

const databases: Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function mutationFor(db: Database) {
  databases.push(db);
  return createLibraryMutation(
    new FakeLibraryStore(db),
    new FakeBooksAppPort(),
  );
}

const invalidIds = [
  "14\n",
  "14\r",
  "14\r\n",
  "14suffix",
  "14.0",
  "14e0",
  " 14",
  "14 ",
  "+14",
  "0xE",
  "0",
  "0000",
  "-14",
  "9007199254740992",
  "9007199254740993",
  "14' OR 1=1 --",
];
const collisionPks = [0, -14, 14, 9007199254740992];
const uuid = "14F00000-0000-4000-8000-000000000099";

describe("mutation identifiers never use partial or unsafe numeric fallbacks", () => {
  for (const operation of [
    {
      name: "add book",
      target: "Book",
      run: (tx: LibraryTx, id: string) =>
        addBookToCollectionTx(tx, id, "target"),
    },
    {
      name: "remove book",
      target: "Book",
      run: (tx: LibraryTx, id: string) =>
        removeBookFromCollectionTx(tx, id, "target"),
    },
    {
      name: "add to collection",
      target: "Collection",
      run: (tx: LibraryTx, id: string) =>
        addBookToCollectionTx(tx, "target", id),
    },
    {
      name: "remove from collection",
      target: "Collection",
      run: (tx: LibraryTx, id: string) =>
        removeBookFromCollectionTx(tx, "target", id),
    },
    {
      name: "delete collection",
      target: "Collection",
      run: deleteCollectionTx,
    },
  ]) {
    test.each(
      invalidIds,
    )(`${operation.name} rejects %s without changing rows`, async (id) => {
      const db = createSeededDb();
      const mutation = mutationFor(db);
      seedBook(db, { pk: 99, assetId: "target", title: "Target" });
      seedCollection(db, { pk: 99, uuid: "target", title: "Target" });
      for (const pk of collisionPks) {
        seedBook(db, { pk, assetId: `book-${pk}`, title: "Unrelated" });
        seedCollection(db, {
          pk,
          uuid: `collection-${pk}`,
          title: "Unrelated",
        });
      }
      const collectionsBefore = db
        .query(`SELECT * FROM ${Tables.Collections} ORDER BY Z_PK`)
        .all();
      const result = await mutation.mutate((tx) => operation.run(tx, id));

      expect(result.success).toBe(false);
      expect(result.message).toBe(`${operation.target} not found: ${id}`);
      expect(
        db.query(`SELECT * FROM ${Tables.Collections} ORDER BY Z_PK`).all(),
      ).toEqual(collectionsBefore);
      expect(
        db.query(`SELECT * FROM ${Tables.CollectionMembers}`).all(),
      ).toEqual([]);
    });
  }

  for (const operation of [
    {
      name: "update note",
      run: (tx: LibraryTx, id: string) =>
        updateAnnotationNoteTx(tx, id, "replacement"),
    },
    { name: "delete annotation", run: deleteAnnotationTx },
  ]) {
    test.each(
      invalidIds,
    )(`${operation.name} rejects %s without changing annotations`, async (id) => {
      const db = createSeededAnnotationDb();
      const mutation = mutationFor(db);
      for (const pk of collisionPks) {
        seedAnnotation(db, {
          pk,
          uuid: `annotation-${pk}`,
          assetId: "book",
          note: "original",
        });
      }
      const before = db
        .query(`SELECT * FROM ${Tables.Annotations} ORDER BY Z_PK`)
        .all();
      const result = await mutation.mutate((tx) => operation.run(tx, id));

      expect(result.success).toBe(false);
      expect(result.message).toBe(`Annotation not found: ${id}`);
      expect(
        db.query(`SELECT * FROM ${Tables.Annotations} ORDER BY Z_PK`).all(),
      ).toEqual(before);
    });
  }
});

describe("annotation natural identities take precedence in every mutation", () => {
  test.each([
    "14",
    "0014",
    "0",
    "-14",
    "9007199254740993",
    "14' OR 1=1 --",
    uuid,
    uuid.toLowerCase(),
  ])("updates and deletes natural ID %s without changing PK 14", async (naturalId) => {
    const db = createSeededAnnotationDb();
    const mutation = mutationFor(db);
    seedAnnotation(db, {
      pk: 14,
      uuid: "unrelated",
      assetId: "book",
      note: "original",
    });
    seedAnnotation(db, { pk: 99, uuid: naturalId, assetId: "book" });
    const id =
      naturalId === uuid
        ? uuid.toLowerCase()
        : naturalId === uuid.toLowerCase()
          ? uuid
          : naturalId;

    const update = await mutation.mutate((tx) =>
      updateAnnotationNoteTx(tx, id, "replacement"),
    );
    expect(update.success).toBe(true);
    if (update.success) expect(update.data.annotationPk).toBe(99);
    const deletion = await mutation.mutate((tx) => deleteAnnotationTx(tx, id));
    expect(deletion.success).toBe(true);
    if (deletion.success) expect(deletion.data.annotationPk).toBe(99);
    expect(
      db
        .query<
          {
            Z_PK: number;
            ZANNOTATIONNOTE: string;
            ZANNOTATIONDELETED: number;
            Z_OPT: number;
          },
          []
        >(
          `SELECT Z_PK, ZANNOTATIONNOTE, ZANNOTATIONDELETED, Z_OPT FROM ${Tables.Annotations} ORDER BY Z_PK`,
        )
        .all(),
    ).toEqual([
      {
        Z_PK: 14,
        ZANNOTATIONNOTE: "original",
        ZANNOTATIONDELETED: 0,
        Z_OPT: 1,
      },
      {
        Z_PK: 99,
        ZANNOTATIONNOTE: "replacement",
        ZANNOTATIONDELETED: 1,
        Z_OPT: 3,
      },
    ]);
  });
});

describe("valid internal primary keys remain supported", () => {
  test.each([
    "14",
    "0014",
    String(Number.MAX_SAFE_INTEGER),
  ])("supports decimal fallback %s across all mutation paths", async (id) => {
    const pk = Number(id);
    const lib = createSeededDb();
    const libraryMutation = mutationFor(lib);
    seedBook(lib, { pk, assetId: "asset", title: "Book" });
    seedCollection(lib, { pk, uuid: "collection", title: "Collection" });
    const add = await libraryMutation.mutate((tx) =>
      addBookToCollectionTx(tx, id, id),
    );
    expect(add.success).toBe(true);
    if (add.success) expect(add.data).toEqual({ bookPk: pk, collectionPk: pk });
    const remove = await libraryMutation.mutate((tx) =>
      removeBookFromCollectionTx(tx, id, id),
    );
    expect(remove.success).toBe(true);
    if (remove.success)
      expect(remove.data).toEqual({ bookPk: pk, collectionPk: pk });
    const collectionDelete = await libraryMutation.mutate((tx) =>
      deleteCollectionTx(tx, id),
    );
    expect(collectionDelete.success).toBe(true);
    if (collectionDelete.success)
      expect(collectionDelete.data.collectionPk).toBe(pk);
    expect(
      lib.query(`SELECT ZDELETEDFLAG FROM ${Tables.Collections}`).get(),
    ).toEqual({ ZDELETEDFLAG: 1 });
    expect(
      lib.query(`SELECT * FROM ${Tables.CollectionMembers}`).all(),
    ).toEqual([]);

    const ann = createSeededAnnotationDb();
    const annotationMutation = mutationFor(ann);
    seedAnnotation(ann, { pk, uuid: "annotation", assetId: "asset" });
    const update = await annotationMutation.mutate((tx) =>
      updateAnnotationNoteTx(tx, id, "replacement"),
    );
    expect(update.success).toBe(true);
    if (update.success) expect(update.data.annotationPk).toBe(pk);
    const annotationDelete = await annotationMutation.mutate((tx) =>
      deleteAnnotationTx(tx, id),
    );
    expect(annotationDelete.success).toBe(true);
    if (annotationDelete.success)
      expect(annotationDelete.data.annotationPk).toBe(pk);
    expect(
      ann
        .query(
          `SELECT ZANNOTATIONNOTE, ZANNOTATIONDELETED FROM ${Tables.Annotations}`,
        )
        .get(),
    ).toEqual({
      ZANNOTATIONNOTE: "replacement",
      ZANNOTATIONDELETED: 1,
    });
  });
});

describe("mutation case handling is entity-specific", () => {
  test.each([
    uuid,
    uuid.toLowerCase(),
  ])("folds only the collection UUID %s when adding, removing and deleting", async (naturalId) => {
    const db = createSeededDb();
    const mutation = mutationFor(db);
    seedBook(db, { pk: 99, assetId: "MiXeD-Asset", title: "Book" });
    seedCollection(db, { pk: 14, uuid: "unrelated", title: "Unrelated" });
    seedCollection(db, { pk: 99, uuid: naturalId, title: "Target" });
    const id = naturalId === uuid ? uuid.toLowerCase() : uuid;

    const wrongBookCase = await mutation.mutate((tx) =>
      addBookToCollectionTx(tx, "mixed-asset", id),
    );
    expect(wrongBookCase.success).toBe(false);
    expect(wrongBookCase.message).toBe("Book not found: mixed-asset");
    const add = await mutation.mutate((tx) =>
      addBookToCollectionTx(tx, "MiXeD-Asset", id),
    );
    expect(add.success).toBe(true);
    if (add.success) expect(add.data).toEqual({ bookPk: 99, collectionPk: 99 });
    const wrongRemoveCase = await mutation.mutate((tx) =>
      removeBookFromCollectionTx(tx, "mixed-asset", id),
    );
    expect(wrongRemoveCase.success).toBe(false);
    expect(wrongRemoveCase.message).toBe("Book not found: mixed-asset");
    const remove = await mutation.mutate((tx) =>
      removeBookFromCollectionTx(tx, "MiXeD-Asset", id),
    );
    expect(remove.success).toBe(true);
    if (remove.success)
      expect(remove.data).toEqual({ bookPk: 99, collectionPk: 99 });
    const deletion = await mutation.mutate((tx) => deleteCollectionTx(tx, id));
    expect(deletion.success).toBe(true);
    if (deletion.success) expect(deletion.data.collectionPk).toBe(99);
    expect(
      db
        .query(
          `SELECT Z_PK, ZDELETEDFLAG FROM ${Tables.Collections} ORDER BY Z_PK`,
        )
        .all(),
    ).toEqual([
      { Z_PK: 14, ZDELETEDFLAG: 0 },
      { Z_PK: 99, ZDELETEDFLAG: 1 },
    ]);
  });

  test.each([
    "MiXeD-Slug",
    "14F-Not-A-UUID",
    uuid,
    `${uuid}\n`,
  ])("never folds asset ID %s or a non-UUID natural key", async (naturalId) => {
    const lib = createSeededDb();
    const libraryMutation = mutationFor(lib);
    seedBook(lib, { pk: 99, assetId: naturalId, title: "Book" });
    seedCollection(lib, { pk: 99, uuid: "collection", title: "Collection" });
    const missingBook = await libraryMutation.mutate((tx) =>
      addBookToCollectionTx(tx, naturalId.toLowerCase(), "collection"),
    );
    expect(missingBook.success).toBe(false);
    expect(missingBook.message).toBe(
      `Book not found: ${naturalId.toLowerCase()}`,
    );
    expect(
      lib.query(`SELECT * FROM ${Tables.CollectionMembers}`).all(),
    ).toEqual([]);

    if (naturalId === uuid) return;
    seedCollection(lib, { pk: 100, uuid: naturalId, title: "Slug collection" });
    const missingCollection = await libraryMutation.mutate((tx) =>
      deleteCollectionTx(tx, naturalId.toLowerCase()),
    );
    expect(missingCollection.success).toBe(false);
    expect(missingCollection.message).toBe(
      `Collection not found: ${naturalId.toLowerCase()}`,
    );
    expect(
      lib
        .query(
          `SELECT ZDELETEDFLAG FROM ${Tables.Collections} WHERE Z_PK = 100`,
        )
        .get(),
    ).toEqual({ ZDELETEDFLAG: 0 });

    const ann = createSeededAnnotationDb();
    const annotationMutation = mutationFor(ann);
    seedAnnotation(ann, {
      pk: 99,
      uuid: naturalId,
      assetId: "asset",
      note: "original",
    });
    const missingAnnotation = await annotationMutation.mutate((tx) =>
      updateAnnotationNoteTx(tx, naturalId.toLowerCase(), "replacement"),
    );
    expect(missingAnnotation.success).toBe(false);
    expect(missingAnnotation.message).toBe(
      `Annotation not found: ${naturalId.toLowerCase()}`,
    );
    expect(
      ann
        .query(
          `SELECT ZANNOTATIONNOTE, ZANNOTATIONDELETED FROM ${Tables.Annotations}`,
        )
        .get(),
    ).toEqual({
      ZANNOTATIONNOTE: "original",
      ZANNOTATIONDELETED: 0,
    });
  });
});
