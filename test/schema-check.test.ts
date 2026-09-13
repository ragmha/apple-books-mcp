import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { Tables } from "../src/db/constants.ts";
import {
  validateAnnotationSchema,
  validateLibrarySchema,
} from "../src/db/schema-check.ts";
import {
  AnnotationSchema,
  BookSchema,
  CollectionSchema,
} from "../src/db/schemas.ts";
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

function fixture(create: () => Database): Database {
  const db = create();
  databases.push(db);
  return db;
}

const libraryColumns = [
  {
    table: Tables.Books,
    columns: [
      "Z_PK",
      "Z_ENT",
      "Z_OPT",
      "ZTITLE",
      "ZASSETID",
      "ZAUTHOR",
      "ZSORTAUTHOR",
      "ZSORTTITLE",
      "ZGENRE",
      "ZLANGUAGE",
      "ZPAGECOUNT",
      "ZRATING",
      "ZISFINISHED",
      "ZREADINGPROGRESS",
      "ZPATH",
      "ZCREATIONDATE",
      "ZMODIFICATIONDATE",
      "ZPURCHASEDATE",
      "ZRELEASEDATE",
      "ZLASTOPENDATE",
      "ZCONTENTTYPE",
      "ZFILESIZE",
      "ZBOOKDESCRIPTION",
      "ZEPUBID",
      "ZCOVERURL",
      "ZDURATION",
      "ZYEAR",
    ],
  },
  {
    table: Tables.Collections,
    columns: [
      "Z_PK",
      "Z_ENT",
      "Z_OPT",
      "ZTITLE",
      "ZCOLLECTIONID",
      "ZDELETEDFLAG",
      "ZHIDDEN",
      "ZSORTKEY",
      "ZSORTMODE",
      "ZLASTMODIFICATION",
      "ZLOCALMODDATE",
      "ZDETAILS",
    ],
  },
  {
    table: Tables.CollectionMembers,
    columns: [
      "Z_PK",
      "Z_ENT",
      "Z_OPT",
      "ZSORTKEY",
      "ZASSET",
      "ZCOLLECTION",
      "ZLOCALMODDATE",
      "ZASSETID",
    ],
  },
  {
    table: Tables.PrimaryKey,
    columns: ["Z_ENT", "Z_NAME", "Z_MAX"],
  },
];

const annotationColumns = [
  {
    table: Tables.Annotations,
    columns: [
      "Z_PK",
      "Z_ENT",
      "Z_OPT",
      "ZANNOTATIONASSETID",
      "ZANNOTATIONSELECTEDTEXT",
      "ZANNOTATIONNOTE",
      "ZANNOTATIONREPRESENTATIVETEXT",
      "ZANNOTATIONSTYLE",
      "ZANNOTATIONTYPE",
      "ZANNOTATIONLOCATION",
      "ZANNOTATIONUUID",
      "ZANNOTATIONCREATIONDATE",
      "ZANNOTATIONMODIFICATIONDATE",
      "ZANNOTATIONDELETED",
      "ZANNOTATIONISUNDERLINE",
    ],
  },
  {
    table: Tables.PrimaryKey,
    columns: ["Z_ENT", "Z_NAME", "Z_MAX"],
  },
];

test("Library fixtures include required nullable presentation fields", () => {
  const db = fixture(createSeededDb);
  seedBook(db, { pk: 1, assetId: "fixture-book", title: "Fixture" });
  seedCollection(db, { pk: 1, uuid: "fixture-collection", title: "Shelf" });
  expect(
    BookSchema.parse(db.query(`SELECT * FROM ${Tables.Books}`).get()),
  ).toMatchObject({ title: "Fixture", genre: "", pageCount: null });
  expect(
    CollectionSchema.parse(
      db.query(`SELECT * FROM ${Tables.Collections}`).get(),
    ),
  ).toMatchObject({ title: "Shelf", details: "" });
});

test("Annotation fixtures include required nullable presentation fields", () => {
  const db = fixture(createSeededAnnotationDb);
  seedAnnotation(db, { pk: 1, uuid: "fixture-note", assetId: "fixture-book" });
  expect(
    AnnotationSchema.parse(
      db.query(`SELECT * FROM ${Tables.Annotations}`).get(),
    ),
  ).toMatchObject({
    uuid: "fixture-note",
    representativeText: "",
    location: "",
  });
});

for (const { label, create, validate, tables } of [
  {
    label: "validateLibrarySchema",
    create: createSeededDb,
    validate: validateLibrarySchema,
    tables: libraryColumns,
  },
  {
    label: "validateAnnotationSchema",
    create: createSeededAnnotationDb,
    validate: validateAnnotationSchema,
    tables: annotationColumns,
  },
]) {
  describe(label, () => {
    test("accepts a complete fixture", () => {
      expect(validate(fixture(create))).toEqual({ ok: true });
    });

    for (const { table, columns } of tables) {
      test(`rejects a missing required table: ${table}`, () => {
        const db = fixture(create);
        db.run(`DROP TABLE ${table}`);
        const result = validate(db);
        expect(result.ok).toBe(false);
        if (!result.ok)
          expect(result.message).toContain(`missing table: ${table}`);
      });

      for (const column of columns) {
        test(`rejects a missing required field: ${table}.${column}`, () => {
          const db = fixture(create);
          db.run(`ALTER TABLE ${table} RENAME COLUMN ${column} TO UNSUPPORTED`);
          const result = validate(db);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.message).toContain(
              `missing column: ${table}.${column}`,
            );
          }
        });
      }
    }
  });
}
