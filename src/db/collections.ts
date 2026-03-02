import {
  getLibraryDb,
  getWritableLibraryDb,
  getLibraryDbPath,
} from "./connection.ts";
import { createDb } from "./query.ts";
import {
  BookSchema,
  CollectionSchema,
  type Collection,
  type Book,
} from "./schemas.ts";
import { Tables, EntityTypes } from "./constants.ts";
import { copyFileSync } from "node:fs";
import { z } from "zod";
import { $ } from "bun";

export function listCollections(): Collection[] {
  const db = createDb(getLibraryDb());
  return db
    .selectFrom(Tables.Collections, CollectionSchema)
    .selectAll()
    .where("ZDELETEDFLAG", "=", 0)
    .orWhere("ZDELETEDFLAG", "IS", null)
    .where("ZTITLE", "!=", "Sync Placeholder")
    .orderBy("ZSORTKEY")
    .execute();
}

export function getCollectionById(collectionId: string): Collection | null {
  const db = createDb(getLibraryDb());

  let collection = db
    .selectFrom(Tables.Collections, CollectionSchema)
    .selectAll()
    .where("ZCOLLECTIONID", "=", collectionId)
    .get();

  if (!collection) {
    const numId = parseInt(collectionId, 10);
    if (!isNaN(numId)) {
      collection = db
        .selectFrom(Tables.Collections, CollectionSchema)
        .selectAll()
        .where("Z_PK", "=", numId)
        .get();
    }
  }
  return collection;
}

const PkRowSchema = z.object({ Z_PK: z.number() });

export function getCollectionBooks(collectionId: string): Book[] {
  const rawDb = getLibraryDb();
  const db = createDb(rawDb);

  // Resolve collection Z_PK
  let collectionPk: number | null = null;
  const byId = db
    .selectFrom(Tables.Collections, PkRowSchema)
    .select("Z_PK")
    .where("ZCOLLECTIONID", "=", collectionId)
    .get();

  if (byId) {
    collectionPk = byId.Z_PK;
  } else {
    const numId = parseInt(collectionId, 10);
    if (!isNaN(numId)) collectionPk = numId;
  }
  if (collectionPk == null) return [];

  // Use raw query for JOIN (query builder doesn't transform joined results well)
  const rows = rawDb
    .query(
      `SELECT a.* FROM ${Tables.Books} a
       JOIN ${Tables.CollectionMembers} cm ON cm.ZASSET = a.Z_PK
       WHERE cm.ZCOLLECTION = ?
       ORDER BY a.ZSORTTITLE ASC`,
    )
    .all(collectionPk);
  return rows.map((row) => BookSchema.parse(row));
}

// --- Write operations ---

function backupDatabase(): string {
  const dbPath = getLibraryDbPath();
  const backupPath = `${dbPath}.backup-${Date.now()}`;
  copyFileSync(dbPath, backupPath);
  return backupPath;
}

async function restartAppleBooks(): Promise<void> {
  try {
    await $`osascript -e 'tell application "Books" to quit'`.quiet();
    await Bun.sleep(1000);
    await $`open -a Books`.quiet();
  } catch {
    // Books may not be running, which is fine
  }
}

function getNextPrimaryKey(
  db: ReturnType<typeof getWritableLibraryDb>,
  entityNum: number,
): number {
  // Atomic increment to avoid race conditions
  db.run(`UPDATE ${Tables.PrimaryKey} SET Z_MAX = Z_MAX + 1 WHERE Z_ENT = ?`, [
    entityNum,
  ]);
  const row = db
    .query<
      { Z_MAX: number },
      [number]
    >(`SELECT Z_MAX FROM ${Tables.PrimaryKey} WHERE Z_ENT = ?`)
    .get(entityNum);
  return row?.Z_MAX ?? 1;
}

export async function addBookToCollection(
  bookId: string,
  collectionId: string,
): Promise<{ success: boolean; message: string }> {
  let backupPath: string;
  try {
    backupPath = backupDatabase();
  } catch (error) {
    return { success: false, message: `Backup failed: ${error}` };
  }

  try {
    const db = getWritableLibraryDb();

    // Resolve book
    let bookPk: number | null = null;
    let assetId: string | null = null;
    const bookByAsset = db
      .query<
        { Z_PK: number; ZASSETID: string },
        [string]
      >(`SELECT Z_PK, ZASSETID FROM ${Tables.Books} WHERE ZASSETID = ?`)
      .get(bookId);
    if (bookByAsset) {
      bookPk = bookByAsset.Z_PK;
      assetId = bookByAsset.ZASSETID;
    } else {
      const numId = parseInt(bookId, 10);
      if (!isNaN(numId)) {
        const bookByPk = db
          .query<
            { Z_PK: number; ZASSETID: string },
            [number]
          >(`SELECT Z_PK, ZASSETID FROM ${Tables.Books} WHERE Z_PK = ?`)
          .get(numId);
        if (bookByPk) {
          bookPk = bookByPk.Z_PK;
          assetId = bookByPk.ZASSETID;
        }
      }
    }
    if (bookPk == null || assetId == null) {
      return { success: false, message: `Book not found: ${bookId}` };
    }

    // Resolve collection
    let collectionPk: number | null = null;
    const collByUuid = db
      .query<
        { Z_PK: number },
        [string]
      >(`SELECT Z_PK FROM ${Tables.Collections} WHERE ZCOLLECTIONID = ?`)
      .get(collectionId);
    if (collByUuid) {
      collectionPk = collByUuid.Z_PK;
    } else {
      const numId = parseInt(collectionId, 10);
      if (!isNaN(numId)) collectionPk = numId;
    }
    if (collectionPk == null) {
      return {
        success: false,
        message: `Collection not found: ${collectionId}`,
      };
    }

    // Check if already a member
    const existing = db
      .query<
        { Z_PK: number },
        [number, number]
      >(`SELECT Z_PK FROM ${Tables.CollectionMembers} WHERE ZCOLLECTION = ? AND ZASSET = ?`)
      .get(collectionPk, bookPk);
    if (existing) {
      return { success: true, message: "Book is already in this collection" };
    }

    // Get next sort key
    const maxSort = db
      .query<
        { maxKey: number | null },
        [number]
      >(`SELECT MAX(ZSORTKEY) as maxKey FROM ${Tables.CollectionMembers} WHERE ZCOLLECTION = ?`)
      .get(collectionPk);
    const sortKey = (maxSort?.maxKey ?? 0) + 1;

    const newPk = getNextPrimaryKey(db, EntityTypes.CollectionMember);
    const now = Date.now() / 1000 - Date.UTC(2001, 0, 1) / 1000;

    db.run(
      `INSERT INTO ${Tables.CollectionMembers} (Z_PK, Z_ENT, Z_OPT, ZSORTKEY, ZASSET, ZCOLLECTION, ZLOCALMODDATE, ZASSETID)
       VALUES (?, ${EntityTypes.CollectionMember}, 1, ?, ?, ?, ?, ?)`,
      [newPk, sortKey, bookPk, collectionPk, now, assetId],
    );

    await restartAppleBooks();
    return {
      success: true,
      message: "Added book to collection. Database backup created.",
    };
  } catch (error) {
    console.error("addBookToCollection error:", error, "Backup:", backupPath);
    return {
      success: false,
      message: "Operation failed. Database backup created.",
    };
  }
}

export async function removeBookFromCollection(
  bookId: string,
  collectionId: string,
): Promise<{ success: boolean; message: string }> {
  let backupPath: string;
  try {
    backupPath = backupDatabase();
  } catch (error) {
    return { success: false, message: `Backup failed: ${error}` };
  }

  try {
    const db = getWritableLibraryDb();

    // Resolve book Z_PK
    let bookPk: number | null = null;
    const bookByAsset = db
      .query<
        { Z_PK: number },
        [string]
      >(`SELECT Z_PK FROM ${Tables.Books} WHERE ZASSETID = ?`)
      .get(bookId);
    if (bookByAsset) {
      bookPk = bookByAsset.Z_PK;
    } else {
      const numId = parseInt(bookId, 10);
      if (!isNaN(numId)) bookPk = numId;
    }
    if (bookPk == null) {
      return { success: false, message: `Book not found: ${bookId}` };
    }

    // Resolve collection Z_PK
    let collectionPk: number | null = null;
    const collByUuid = db
      .query<
        { Z_PK: number },
        [string]
      >(`SELECT Z_PK FROM ${Tables.Collections} WHERE ZCOLLECTIONID = ?`)
      .get(collectionId);
    if (collByUuid) {
      collectionPk = collByUuid.Z_PK;
    } else {
      const numId = parseInt(collectionId, 10);
      if (!isNaN(numId)) collectionPk = numId;
    }
    if (collectionPk == null) {
      return {
        success: false,
        message: `Collection not found: ${collectionId}`,
      };
    }

    const result = db.run(
      `DELETE FROM ${Tables.CollectionMembers} WHERE ZCOLLECTION = ? AND ZASSET = ?`,
      [collectionPk, bookPk],
    );

    if (result.changes === 0) {
      return { success: false, message: "Book was not in this collection" };
    }

    await restartAppleBooks();
    return {
      success: true,
      message: "Removed book from collection. Database backup created.",
    };
  } catch (error) {
    console.error(
      "removeBookFromCollection error:",
      error,
      "Backup:",
      backupPath,
    );
    return {
      success: false,
      message: "Operation failed. Database backup created.",
    };
  }
}

export async function createCollection(
  name: string,
): Promise<{ success: boolean; message: string; collectionId?: string }> {
  let backupPath: string;
  try {
    backupPath = backupDatabase();
  } catch (error) {
    return { success: false, message: `Backup failed: ${error}` };
  }

  try {
    const db = getWritableLibraryDb();
    const collectionUuid = crypto.randomUUID().toUpperCase();

    // Get max sort key
    const maxSort = db
      .query<
        { maxKey: number | null },
        []
      >(`SELECT MAX(ZSORTKEY) as maxKey FROM ${Tables.Collections}`)
      .get();
    const sortKey = (maxSort?.maxKey ?? 0) + 1;

    const newPk = getNextPrimaryKey(db, EntityTypes.Collection);
    const now = Date.now() / 1000 - Date.UTC(2001, 0, 1) / 1000;

    db.run(
      `INSERT INTO ${Tables.Collections} (Z_PK, Z_ENT, Z_OPT, ZDELETEDFLAG, ZHIDDEN, ZPLACEHOLDER, ZSORTKEY, ZSORTMODE, ZVIEWMODE, ZLASTMODIFICATION, ZLOCALMODDATE, ZCOLLECTIONID, ZDETAILS, ZTITLE)
       VALUES (?, ${EntityTypes.Collection}, 1, 0, 0, 0, ?, 0, 0, ?, ?, ?, NULL, ?)`,
      [newPk, sortKey, now, now, collectionUuid, name],
    );

    await restartAppleBooks();
    return {
      success: true,
      message: `Created collection "${name}". Database backup created.`,
      collectionId: collectionUuid,
    };
  } catch (error) {
    console.error("createCollection error:", error, "Backup:", backupPath);
    return {
      success: false,
      message: "Operation failed. Database backup created.",
    };
  }
}

export async function deleteCollection(
  collectionId: string,
): Promise<{ success: boolean; message: string }> {
  let backupPath: string;
  try {
    backupPath = backupDatabase();
  } catch (error) {
    return { success: false, message: `Backup failed: ${error}` };
  }

  try {
    const db = getWritableLibraryDb();
    const now = Date.now() / 1000 - Date.UTC(2001, 0, 1) / 1000;

    // Soft delete: set ZDELETEDFLAG = 1
    const result = db.run(
      `UPDATE ${Tables.Collections} SET ZDELETEDFLAG = 1, ZLASTMODIFICATION = ?, ZLOCALMODDATE = ? WHERE ZCOLLECTIONID = ?`,
      [now, now, collectionId],
    );

    if (result.changes === 0) {
      // Try by Z_PK
      const numId = parseInt(collectionId, 10);
      if (!isNaN(numId)) {
        const result2 = db.run(
          `UPDATE ${Tables.Collections} SET ZDELETEDFLAG = 1, ZLASTMODIFICATION = ?, ZLOCALMODDATE = ? WHERE Z_PK = ?`,
          [now, now, numId],
        );
        if (result2.changes === 0) {
          return {
            success: false,
            message: `Collection not found: ${collectionId}`,
          };
        }
      } else {
        return {
          success: false,
          message: `Collection not found: ${collectionId}`,
        };
      }
    }

    await restartAppleBooks();
    return {
      success: true,
      message: "Deleted collection. Database backup created.",
    };
  } catch (error) {
    console.error("deleteCollection error:", error, "Backup:", backupPath);
    return {
      success: false,
      message: "Operation failed. Database backup created.",
    };
  }
}
