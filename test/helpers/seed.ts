import { Database } from "bun:sqlite";
import { Tables } from "../../src/db/constants.ts";

/**
 * Build a complete in-memory Library schema for both reads and mutations.
 */
export function createSeededDb(): Database {
  const db = new Database(":memory:");

  db.run(`
    CREATE TABLE Z_PRIMARYKEY (
      Z_ENT INTEGER PRIMARY KEY,
      Z_NAME TEXT,
      Z_SUPER INTEGER,
      Z_MAX INTEGER
    )
  `);

  db.run(`
    CREATE TABLE ${Tables.Books} (
      Z_PK INTEGER PRIMARY KEY,
      Z_ENT INTEGER,
      Z_OPT INTEGER,
      ZASSETID TEXT,
      ZTITLE TEXT,
      ZAUTHOR TEXT,
      ZSORTAUTHOR TEXT,
      ZSORTTITLE TEXT,
      ZGENRE TEXT,
      ZLANGUAGE TEXT,
      ZPAGECOUNT INTEGER,
      ZRATING INTEGER,
      ZISFINISHED INTEGER,
      ZREADINGPROGRESS REAL,
      ZPATH TEXT,
      ZCREATIONDATE REAL,
      ZMODIFICATIONDATE REAL,
      ZPURCHASEDATE REAL,
      ZRELEASEDATE REAL,
      ZLASTOPENDATE REAL,
      ZCONTENTTYPE INTEGER,
      ZFILESIZE INTEGER,
      ZBOOKDESCRIPTION TEXT,
      ZEPUBID TEXT,
      ZCOVERURL TEXT,
      ZDURATION REAL,
      ZYEAR TEXT
    )
  `);

  db.run(`
    CREATE TABLE ${Tables.Collections} (
      Z_PK INTEGER PRIMARY KEY,
      Z_ENT INTEGER,
      Z_OPT INTEGER,
      ZDELETEDFLAG INTEGER,
      ZHIDDEN INTEGER,
      ZSORTKEY REAL,
      ZSORTMODE INTEGER,
      ZLASTMODIFICATION REAL,
      ZLOCALMODDATE REAL,
      ZCOLLECTIONID TEXT,
      ZTITLE TEXT,
      ZDETAILS TEXT
    )
  `);

  db.run(`
    CREATE TABLE ${Tables.CollectionMembers} (
      Z_PK INTEGER PRIMARY KEY,
      Z_ENT INTEGER,
      Z_OPT INTEGER,
      ZSORTKEY REAL,
      ZASSET INTEGER,
      ZCOLLECTION INTEGER,
      ZLOCALMODDATE REAL,
      ZASSETID TEXT
    )
  `);

  // Keep fixture assignments independent of the production entity constants.
  db.run(`
    INSERT INTO Z_PRIMARYKEY (Z_ENT, Z_NAME, Z_SUPER, Z_MAX) VALUES
      (1, 'BKLibraryAsset', 0, 0),
      (2, 'BKCollection', 0, 0),
      (3, 'BKCollectionMember', 0, 0)
  `);

  return db;
}

/**
 * Convenience: insert a Book row directly (tests usually need fixture data
 * that already lives in the Library, not data created by mutations under test).
 */
export function seedBook(
  db: Database,
  opts: { pk: number; assetId: string; title: string; author?: string },
): void {
  db.run(
    `INSERT INTO ${Tables.Books} (Z_PK, Z_ENT, Z_OPT, ZASSETID, ZTITLE, ZAUTHOR, ZCONTENTTYPE)
     VALUES (?, 1, 1, ?, ?, ?, 1)`,
    [opts.pk, opts.assetId, opts.title, opts.author ?? "Unknown"],
  );
  db.run("UPDATE Z_PRIMARYKEY SET Z_MAX = MAX(Z_MAX, ?) WHERE Z_ENT = 1", [
    opts.pk,
  ]);
}

/** Convenience: insert a Collection row directly. */
export function seedCollection(
  db: Database,
  opts: { pk: number; uuid: string; title: string },
): void {
  db.run(
    `INSERT INTO ${Tables.Collections}
     (Z_PK, Z_ENT, Z_OPT, ZDELETEDFLAG, ZHIDDEN, ZSORTKEY, ZLASTMODIFICATION, ZLOCALMODDATE, ZCOLLECTIONID, ZTITLE)
     VALUES (?, 2, 1, 0, 0, ?, 0, 0, ?, ?)`,
    [opts.pk, opts.pk, opts.uuid, opts.title],
  );
  db.run("UPDATE Z_PRIMARYKEY SET Z_MAX = MAX(Z_MAX, ?) WHERE Z_ENT = 2", [
    opts.pk,
  ]);
}

/**
 * Build a fresh in-memory SQLite seeded with the Apple Books AEAnnotation
 * schema for reads and mutations. This is a separate Core Data store.
 */
export function createSeededAnnotationDb(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE Z_PRIMARYKEY (
      Z_ENT INTEGER PRIMARY KEY,
      Z_NAME TEXT,
      Z_SUPER INTEGER,
      Z_MAX INTEGER
    )
  `);
  db.run(`
    CREATE TABLE ${Tables.Annotations} (
      Z_PK INTEGER PRIMARY KEY,
      Z_ENT INTEGER,
      Z_OPT INTEGER,
      ZANNOTATIONUUID TEXT,
      ZANNOTATIONASSETID TEXT,
      ZANNOTATIONSELECTEDTEXT TEXT,
      ZANNOTATIONNOTE TEXT,
      ZANNOTATIONREPRESENTATIVETEXT TEXT,
      ZANNOTATIONSTYLE INTEGER,
      ZANNOTATIONTYPE INTEGER,
      ZANNOTATIONLOCATION TEXT,
      ZANNOTATIONCREATIONDATE REAL,
      ZANNOTATIONMODIFICATIONDATE REAL,
      ZANNOTATIONDELETED INTEGER,
      ZANNOTATIONISUNDERLINE INTEGER
    )
  `);
  db.run(`
    INSERT INTO Z_PRIMARYKEY (Z_ENT, Z_NAME, Z_SUPER, Z_MAX)
    VALUES (1, 'AEAnnotation', 0, 0)
  `);
  return db;
}

/** Convenience: insert an Annotation row directly. */
export function seedAnnotation(
  db: Database,
  opts: {
    pk: number;
    uuid: string;
    assetId: string;
    selectedText?: string;
    note?: string;
    style?: number;
    deleted?: boolean;
  },
): void {
  db.run(
    `INSERT INTO ${Tables.Annotations}
     (Z_PK, Z_ENT, Z_OPT, ZANNOTATIONUUID, ZANNOTATIONASSETID,
      ZANNOTATIONSELECTEDTEXT, ZANNOTATIONNOTE, ZANNOTATIONSTYLE,
      ZANNOTATIONTYPE, ZANNOTATIONDELETED,
      ZANNOTATIONCREATIONDATE, ZANNOTATIONMODIFICATIONDATE)
     VALUES (?, 1, 1, ?, ?, ?, ?, ?, 0, ?, 0, 0)`,
    [
      opts.pk,
      opts.uuid,
      opts.assetId,
      opts.selectedText ?? "",
      opts.note ?? "",
      opts.style ?? 1,
      opts.deleted ? 1 : 0,
    ],
  );
  db.run("UPDATE Z_PRIMARYKEY SET Z_MAX = MAX(Z_MAX, ?) WHERE Z_ENT = 1", [
    opts.pk,
  ]);
}
