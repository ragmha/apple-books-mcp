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
import { createLibraryMutation } from "../src/db/library-mutation.ts";
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

describe("inactive annotation mutations", () => {
  for (const operation of ["update", "delete"] as const) {
    test.each([
      "14",
      "99",
    ])(`${operation} rejects deleted identity %s without touching an active PK collision`, async (id) => {
      const db = createSeededAnnotationDb();
      const mutation = mutationFor(db);
      seedAnnotation(db, {
        pk: 14,
        uuid: "active",
        assetId: "book",
        note: "active note",
      });
      seedAnnotation(db, {
        pk: 99,
        uuid: "14",
        assetId: "book",
        note: "deleted note",
        deleted: true,
      });

      const result = await mutation.mutate((tx) =>
        operation === "update"
          ? updateAnnotationNoteTx(tx, id, "replacement")
          : deleteAnnotationTx(tx, id),
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain(
        operation === "delete" ? "already deleted" : "deleted",
      );
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
          ZANNOTATIONNOTE: "active note",
          ZANNOTATIONDELETED: 0,
          Z_OPT: 1,
        },
        {
          Z_PK: 99,
          ZANNOTATIONNOTE: "deleted note",
          ZANNOTATIONDELETED: 1,
          Z_OPT: 1,
        },
      ]);
    });
  }
});

describe("inactive collection mutations", () => {
  for (const operation of ["add", "remove", "delete"] as const) {
    test.each([
      "14",
      "99",
    ])(`${operation} rejects deleted identity %s before considering an active PK collision`, async (id) => {
      const db = createSeededDb();
      const mutation = mutationFor(db);
      seedBook(db, { pk: 7, assetId: "book", title: "Book" });
      seedCollection(db, { pk: 14, uuid: "active", title: "Active" });
      seedCollection(db, { pk: 99, uuid: "14", title: "Deleted" });
      db.run(
        `UPDATE ${Tables.Collections} SET ZDELETEDFLAG = 1 WHERE Z_PK = 99`,
      );
      if (operation === "remove") {
        for (const pk of [14, 99]) {
          db.run(
            `INSERT INTO ${Tables.CollectionMembers} (Z_PK, ZASSET, ZCOLLECTION) VALUES (?, 7, ?)`,
            [pk, pk],
          );
        }
      }

      const result = await mutation.mutate((tx) => {
        if (operation === "add") return addBookToCollectionTx(tx, "book", id);
        if (operation === "remove")
          return removeBookFromCollectionTx(tx, "book", id);
        return deleteCollectionTx(tx, id);
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("deleted");
      expect(
        db
          .query<{ Z_PK: number; ZDELETEDFLAG: number; Z_OPT: number }, []>(
            `SELECT Z_PK, ZDELETEDFLAG, Z_OPT FROM ${Tables.Collections} ORDER BY Z_PK`,
          )
          .all(),
      ).toEqual([
        { Z_PK: 14, ZDELETEDFLAG: 0, Z_OPT: 1 },
        { Z_PK: 99, ZDELETEDFLAG: 1, Z_OPT: 1 },
      ]);
      expect(
        db
          .query<{ ZCOLLECTION: number }, []>(
            `SELECT ZCOLLECTION FROM ${Tables.CollectionMembers} ORDER BY ZCOLLECTION`,
          )
          .all(),
      ).toEqual(
        operation === "remove"
          ? [{ ZCOLLECTION: 14 }, { ZCOLLECTION: 99 }]
          : [],
      );
    });
  }
});
