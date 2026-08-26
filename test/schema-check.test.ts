import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Tables } from "../src/db/constants.ts";
import {
  validateAnnotationSchema,
  validateLibrarySchema,
} from "../src/db/schema-check.ts";

describe("validateLibrarySchema", () => {
  test("returns ok for a Library with all expected columns", () => {
    const db = new Database(":memory:");
    db.run(`
      CREATE TABLE ${Tables.Books} (
        Z_PK INTEGER PRIMARY KEY,
        Z_ENT INTEGER, Z_OPT INTEGER,
        ZASSETID TEXT, ZTITLE TEXT, ZAUTHOR TEXT
      )
    `);
    db.run(`
      CREATE TABLE ${Tables.Collections} (
        Z_PK INTEGER PRIMARY KEY,
        Z_ENT INTEGER, Z_OPT INTEGER,
        ZTITLE TEXT, ZCOLLECTIONID TEXT, ZDELETEDFLAG INTEGER
      )
    `);
    db.run(
      `CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER, Z_NAME TEXT, Z_MAX INTEGER)`,
    );

    expect(validateLibrarySchema(db)).toEqual({ ok: true });
  });

  test("returns an error listing the missing table when ZBKLIBRARYASSET is absent", () => {
    const db = new Database(":memory:");
    db.run(
      `CREATE TABLE ${Tables.Collections} (Z_PK INTEGER, Z_ENT INTEGER, Z_OPT INTEGER, ZTITLE TEXT, ZCOLLECTIONID TEXT, ZDELETEDFLAG INTEGER)`,
    );
    db.run(
      `CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER, Z_NAME TEXT, Z_MAX INTEGER)`,
    );

    const result = validateLibrarySchema(db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(Tables.Books);
      expect(result.message).toMatch(/missing table/i);
    }
  });

  test("returns an error listing the missing column when ZASSETID is absent from ZBKLIBRARYASSET", () => {
    const db = new Database(":memory:");
    db.run(
      `CREATE TABLE ${Tables.Books} (Z_PK INTEGER, Z_ENT INTEGER, Z_OPT INTEGER, ZTITLE TEXT, ZAUTHOR TEXT)`,
    );
    db.run(
      `CREATE TABLE ${Tables.Collections} (Z_PK INTEGER, Z_ENT INTEGER, Z_OPT INTEGER, ZTITLE TEXT, ZCOLLECTIONID TEXT, ZDELETEDFLAG INTEGER)`,
    );
    db.run(
      `CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER, Z_NAME TEXT, Z_MAX INTEGER)`,
    );

    const result = validateLibrarySchema(db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("ZASSETID");
    }
  });
});

describe("validateAnnotationSchema", () => {
  test("returns ok for an Annotations DB with all expected columns", () => {
    const db = new Database(":memory:");
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
        ZANNOTATIONLOCATION TEXT,
        ZANNOTATIONNOTE TEXT,
        ZANNOTATIONREPRESENTATIVETEXT TEXT,
        ZANNOTATIONSELECTEDTEXT TEXT,
        ZANNOTATIONSTYLE INTEGER,
        ZANNOTATIONTYPE INTEGER,
        ZANNOTATIONISUNDERLINE INTEGER,
        ZANNOTATIONCREATIONDATE REAL,
        ZANNOTATIONDELETED INTEGER,
        ZANNOTATIONMODIFICATIONDATE REAL
      )
    `);
    db.run(
      "CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER, Z_NAME TEXT, Z_MAX INTEGER)",
    );

    expect(validateAnnotationSchema(db)).toEqual({ ok: true });
  });

  test("returns an error listing the missing column when ZANNOTATIONUUID is absent", () => {
    const db = new Database(":memory:");
    db.run(`
      CREATE TABLE ${Tables.Annotations} (
        Z_PK INTEGER PRIMARY KEY,
        Z_OPT INTEGER,
        ZANNOTATIONASSETID TEXT,
        ZANNOTATIONNOTE TEXT,
        ZANNOTATIONDELETED INTEGER,
        ZANNOTATIONMODIFICATIONDATE REAL
      )
    `);

    const result = validateAnnotationSchema(db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("ZANNOTATIONUUID");
    }
  });

  test("returns an error when anchored-highlight coordinates are unavailable", () => {
    const db = new Database(":memory:");
    db.run(`
      CREATE TABLE ${Tables.Annotations} (
        Z_PK INTEGER PRIMARY KEY,
        Z_ENT INTEGER,
        Z_OPT INTEGER,
        ZPLABSOLUTEPHYSICALLOCATION INTEGER,
        ZPLLOCATIONRANGESTART INTEGER,
        ZANNOTATIONUUID TEXT,
        ZANNOTATIONASSETID TEXT,
        ZANNOTATIONCREATORIDENTIFIER TEXT,
        ZANNOTATIONLOCATION TEXT,
        ZANNOTATIONNOTE TEXT,
        ZANNOTATIONREPRESENTATIVETEXT TEXT,
        ZANNOTATIONSELECTEDTEXT TEXT,
        ZANNOTATIONSTYLE INTEGER,
        ZANNOTATIONTYPE INTEGER,
        ZANNOTATIONISUNDERLINE INTEGER,
        ZANNOTATIONCREATIONDATE REAL,
        ZANNOTATIONDELETED INTEGER,
        ZANNOTATIONMODIFICATIONDATE REAL
      )
    `);
    db.run(
      "CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER, Z_NAME TEXT, Z_MAX INTEGER)",
    );

    const result = validateAnnotationSchema(db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("ZPLLOCATIONRANGEEND");
    }
  });
});
