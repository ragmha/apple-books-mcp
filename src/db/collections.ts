import { getLibraryDb, getWritableLibraryDb, getLibraryDbPath } from "./connection.ts";
import type { CollectionRow, CollectionMemberRow, BookRow } from "../types.ts";
import { collectionFromRow, bookFromRow, type Collection, type Book } from "../types.ts";
import { copyFileSync } from "node:fs";
import { $ } from "bun";

export function listCollections(): Collection[] {
  const db = getLibraryDb();
  const rows = db
    .query<CollectionRow, []>(
      `SELECT * FROM ZBKCOLLECTION
       WHERE (ZDELETEDFLAG = 0 OR ZDELETEDFLAG IS NULL)
         AND ZTITLE != 'Sync Placeholder'
       ORDER BY ZSORTKEY ASC`
    )
    .all();
  return rows.map(collectionFromRow);
}

export function getCollectionById(collectionId: string): Collection | null {
  const db = getLibraryDb();
  let row = db
    .query<CollectionRow, [string]>(
      `SELECT * FROM ZBKCOLLECTION WHERE ZCOLLECTIONID = ?`
    )
    .get(collectionId);
  if (!row) {
    const numId = parseInt(collectionId, 10);
    if (!isNaN(numId)) {
      row = db
        .query<CollectionRow, [number]>(
          `SELECT * FROM ZBKCOLLECTION WHERE Z_PK = ?`
        )
        .get(numId);
    }
  }
  return row ? collectionFromRow(row) : null;
}

export function getCollectionBooks(collectionId: string): Book[] {
  const db = getLibraryDb();
  // Resolve collection Z_PK
  let collectionPk: number | null = null;
  const byId = db
    .query<{ Z_PK: number }, [string]>(
      `SELECT Z_PK FROM ZBKCOLLECTION WHERE ZCOLLECTIONID = ?`
    )
    .get(collectionId);
  if (byId) {
    collectionPk = byId.Z_PK;
  } else {
    const numId = parseInt(collectionId, 10);
    if (!isNaN(numId)) collectionPk = numId;
  }
  if (collectionPk == null) return [];

  const rows = db
    .query<BookRow, [number]>(
      `SELECT a.* FROM ZBKLIBRARYASSET a
       JOIN ZBKCOLLECTIONMEMBER cm ON cm.ZASSET = a.Z_PK
       WHERE cm.ZCOLLECTION = ?
       ORDER BY a.ZSORTTITLE ASC`
    )
    .all(collectionPk);
  return rows.map(bookFromRow);
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

function getNextPrimaryKey(db: ReturnType<typeof getWritableLibraryDb>, entityNum: number): number {
  const row = db
    .query<{ Z_MAX: number }, [number]>("SELECT Z_MAX FROM Z_PRIMARYKEY WHERE Z_ENT = ?")
    .get(entityNum);
  const nextPk = (row?.Z_MAX ?? 0) + 1;
  db.run("UPDATE Z_PRIMARYKEY SET Z_MAX = ? WHERE Z_ENT = ?", [nextPk, entityNum]);
  return nextPk;
}

export async function addBookToCollection(
  bookId: string,
  collectionId: string
): Promise<{ success: boolean; message: string }> {
  const backupPath = backupDatabase();

  try {
    const db = getWritableLibraryDb();

    // Resolve book
    let bookPk: number | null = null;
    let assetId: string | null = null;
    const bookByAsset = db
      .query<{ Z_PK: number; ZASSETID: string }, [string]>(
        "SELECT Z_PK, ZASSETID FROM ZBKLIBRARYASSET WHERE ZASSETID = ?"
      )
      .get(bookId);
    if (bookByAsset) {
      bookPk = bookByAsset.Z_PK;
      assetId = bookByAsset.ZASSETID;
    } else {
      const numId = parseInt(bookId, 10);
      if (!isNaN(numId)) {
        const bookByPk = db
          .query<{ Z_PK: number; ZASSETID: string }, [number]>(
            "SELECT Z_PK, ZASSETID FROM ZBKLIBRARYASSET WHERE Z_PK = ?"
          )
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
      .query<{ Z_PK: number }, [string]>(
        "SELECT Z_PK FROM ZBKCOLLECTION WHERE ZCOLLECTIONID = ?"
      )
      .get(collectionId);
    if (collByUuid) {
      collectionPk = collByUuid.Z_PK;
    } else {
      const numId = parseInt(collectionId, 10);
      if (!isNaN(numId)) collectionPk = numId;
    }
    if (collectionPk == null) {
      return { success: false, message: `Collection not found: ${collectionId}` };
    }

    // Check if already a member
    const existing = db
      .query<{ Z_PK: number }, [number, number]>(
        "SELECT Z_PK FROM ZBKCOLLECTIONMEMBER WHERE ZCOLLECTION = ? AND ZASSET = ?"
      )
      .get(collectionPk, bookPk);
    if (existing) {
      return { success: true, message: "Book is already in this collection" };
    }

    // Get next sort key
    const maxSort = db
      .query<{ maxKey: number | null }, [number]>(
        "SELECT MAX(ZSORTKEY) as maxKey FROM ZBKCOLLECTIONMEMBER WHERE ZCOLLECTION = ?"
      )
      .get(collectionPk);
    const sortKey = (maxSort?.maxKey ?? 0) + 1;

    // Entity 3 = BKCollectionMember
    const newPk = getNextPrimaryKey(db, 3);
    const now = (Date.now() / 1000) - (Date.UTC(2001, 0, 1) / 1000);

    db.run(
      `INSERT INTO ZBKCOLLECTIONMEMBER (Z_PK, Z_ENT, Z_OPT, ZSORTKEY, ZASSET, ZCOLLECTION, ZLOCALMODDATE, ZASSETID)
       VALUES (?, 3, 1, ?, ?, ?, ?, ?)`,
      [newPk, sortKey, bookPk, collectionPk, now, assetId]
    );

    await restartAppleBooks();
    return { success: true, message: `Added book to collection. Backup at: ${backupPath}` };
  } catch (error) {
    return { success: false, message: `Error: ${error}. Backup at: ${backupPath}` };
  }
}

export async function removeBookFromCollection(
  bookId: string,
  collectionId: string
): Promise<{ success: boolean; message: string }> {
  const backupPath = backupDatabase();

  try {
    const db = getWritableLibraryDb();

    // Resolve book Z_PK
    let bookPk: number | null = null;
    const bookByAsset = db
      .query<{ Z_PK: number }, [string]>(
        "SELECT Z_PK FROM ZBKLIBRARYASSET WHERE ZASSETID = ?"
      )
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
      .query<{ Z_PK: number }, [string]>(
        "SELECT Z_PK FROM ZBKCOLLECTION WHERE ZCOLLECTIONID = ?"
      )
      .get(collectionId);
    if (collByUuid) {
      collectionPk = collByUuid.Z_PK;
    } else {
      const numId = parseInt(collectionId, 10);
      if (!isNaN(numId)) collectionPk = numId;
    }
    if (collectionPk == null) {
      return { success: false, message: `Collection not found: ${collectionId}` };
    }

    const result = db.run(
      "DELETE FROM ZBKCOLLECTIONMEMBER WHERE ZCOLLECTION = ? AND ZASSET = ?",
      [collectionPk, bookPk]
    );

    if (result.changes === 0) {
      return { success: false, message: "Book was not in this collection" };
    }

    await restartAppleBooks();
    return { success: true, message: `Removed book from collection. Backup at: ${backupPath}` };
  } catch (error) {
    return { success: false, message: `Error: ${error}. Backup at: ${backupPath}` };
  }
}

export async function createCollection(
  name: string
): Promise<{ success: boolean; message: string; collectionId?: string }> {
  const backupPath = backupDatabase();

  try {
    const db = getWritableLibraryDb();
    const collectionUuid = crypto.randomUUID().toUpperCase();

    // Get max sort key
    const maxSort = db
      .query<{ maxKey: number | null }, []>(
        "SELECT MAX(ZSORTKEY) as maxKey FROM ZBKCOLLECTION"
      )
      .get();
    const sortKey = (maxSort?.maxKey ?? 0) + 1;

    // Entity 2 = BKCollection
    const newPk = getNextPrimaryKey(db, 2);
    const now = (Date.now() / 1000) - (Date.UTC(2001, 0, 1) / 1000);

    db.run(
      `INSERT INTO ZBKCOLLECTION (Z_PK, Z_ENT, Z_OPT, ZDELETEDFLAG, ZHIDDEN, ZPLACEHOLDER, ZSORTKEY, ZSORTMODE, ZVIEWMODE, ZLASTMODIFICATION, ZLOCALMODDATE, ZCOLLECTIONID, ZDETAILS, ZTITLE)
       VALUES (?, 2, 1, 0, 0, 0, ?, 0, 0, ?, ?, ?, NULL, ?)`,
      [newPk, sortKey, now, now, collectionUuid, name]
    );

    await restartAppleBooks();
    return { success: true, message: `Created collection "${name}". Backup at: ${backupPath}`, collectionId: collectionUuid };
  } catch (error) {
    return { success: false, message: `Error: ${error}. Backup at: ${backupPath}` };
  }
}

export async function deleteCollection(
  collectionId: string
): Promise<{ success: boolean; message: string }> {
  const backupPath = backupDatabase();

  try {
    const db = getWritableLibraryDb();
    const now = (Date.now() / 1000) - (Date.UTC(2001, 0, 1) / 1000);

    // Soft delete: set ZDELETEDFLAG = 1
    const result = db.run(
      "UPDATE ZBKCOLLECTION SET ZDELETEDFLAG = 1, ZLASTMODIFICATION = ?, ZLOCALMODDATE = ? WHERE ZCOLLECTIONID = ?",
      [now, now, collectionId]
    );

    if (result.changes === 0) {
      // Try by Z_PK
      const numId = parseInt(collectionId, 10);
      if (!isNaN(numId)) {
        const result2 = db.run(
          "UPDATE ZBKCOLLECTION SET ZDELETEDFLAG = 1, ZLASTMODIFICATION = ?, ZLOCALMODDATE = ? WHERE Z_PK = ?",
          [now, now, numId]
        );
        if (result2.changes === 0) {
          return { success: false, message: `Collection not found: ${collectionId}` };
        }
      } else {
        return { success: false, message: `Collection not found: ${collectionId}` };
      }
    }

    await restartAppleBooks();
    return { success: true, message: `Deleted collection. Backup at: ${backupPath}` };
  } catch (error) {
    return { success: false, message: `Error: ${error}. Backup at: ${backupPath}` };
  }
}
