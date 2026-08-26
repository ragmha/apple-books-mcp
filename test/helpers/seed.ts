import { Database } from "bun:sqlite";
import { EntityTypes, Tables } from "../../src/db/constants.ts";

/**
 * Build a fresh in-memory SQLite seeded with the minimum Apple Books
 * Core Data schema needed for LibraryMutation tests:
 *   - Z_PRIMARYKEY (the allocator) with rows for Collection + CollectionMember
 *   - ZBKCOLLECTION (Collections)
 *   - ZBKCOLLECTIONMEMBER (Collection ↔ Asset join)
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
      ZCONTENTTYPE INTEGER
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
      ZLASTMODIFICATION REAL,
      ZLOCALMODDATE REAL,
      ZCOLLECTIONID TEXT,
      ZTITLE TEXT
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

  // Seed Z_PRIMARYKEY rows so getNextPrimaryKey has something to bump.
  db.run(
    "INSERT INTO Z_PRIMARYKEY (Z_ENT, Z_NAME, Z_SUPER, Z_MAX) VALUES (?, ?, 0, 0)",
    [EntityTypes.Collection, "BKCollection"],
  );
  db.run(
    "INSERT INTO Z_PRIMARYKEY (Z_ENT, Z_NAME, Z_SUPER, Z_MAX) VALUES (?, ?, 0, 0)",
    [EntityTypes.CollectionMember, "BKCollectionMember"],
  );

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
}

/**
 * Build a fresh in-memory SQLite seeded with the Apple Books AEAnnotation
 * schema needed for annotation-mutation tests. The annotation DB is a
 * separate Core Data store from the Library DB; we only need the
 * `ZAEANNOTATION` table for our updates.
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
      ZPLABSOLUTEPHYSICALLOCATION INTEGER,
      ZPLLOCATIONRANGEEND INTEGER,
      ZPLLOCATIONRANGESTART INTEGER,
      ZANNOTATIONUUID TEXT,
      ZANNOTATIONASSETID TEXT,
      ZANNOTATIONCREATORIDENTIFIER TEXT,
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
  db.run(
    "INSERT INTO Z_PRIMARYKEY (Z_ENT, Z_NAME, Z_SUPER, Z_MAX) VALUES (1, 'AEAnnotation', 0, 0)",
  );
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
    creatorIdentifier?: string;
  },
): void {
  db.run(
    `INSERT INTO ${Tables.Annotations}
     (Z_PK, Z_ENT, Z_OPT, ZANNOTATIONUUID, ZANNOTATIONASSETID,
      ZANNOTATIONCREATORIDENTIFIER, ZANNOTATIONSELECTEDTEXT,
      ZANNOTATIONNOTE, ZANNOTATIONSTYLE,
      ZANNOTATIONTYPE, ZANNOTATIONDELETED,
      ZANNOTATIONCREATIONDATE, ZANNOTATIONMODIFICATIONDATE)
     VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0)`,
    [
      opts.pk,
      opts.uuid,
      opts.assetId,
      opts.creatorIdentifier ?? null,
      opts.selectedText ?? "",
      opts.note ?? "",
      opts.style ?? 1,
      opts.deleted ? 1 : 0,
    ],
  );
}
