import { z } from "zod";
import { getLibraryDb } from "./connection.ts";
import { EntityTypes, Tables } from "./constants.ts";
import { coreDataNow } from "./core-data.ts";
import {
  type LibraryTx,
  MutationError,
  type MutationResult,
} from "./library-mutation.ts";
import { productionMutation } from "./library-mutation-singleton.ts";
import { createDb } from "./query.ts";
import {
  type Book,
  BookSchema,
  type Collection,
  CollectionSchema,
} from "./schemas.ts";

export function listCollections(): Collection[] {
  const db = createDb(getLibraryDb());
  return db
    .selectFrom(Tables.Collections, CollectionSchema)
    .selectAll()
    .whereRaw("COALESCE(ZDELETEDFLAG, 0) = 0")
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
    if (!Number.isNaN(numId)) {
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
    if (!Number.isNaN(numId)) collectionPk = numId;
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
//
// All four mutating operations route through `LibraryMutation.mutate`:
// the safety ceremony (snapshot, integrity-check, quit Books, BEGIN
// IMMEDIATE, COMMIT/ROLLBACK, relaunch Books, sanitised errors) lives in
// one place and Core Data row mechanics (Z_PK allocation, Z_ENT, Z_OPT,
// mtimes) are baked into LibraryTx so callers can't forget them.
//
// Each `*Tx` function is the pure description of "what changes" — exported
// so tests can drive it against an in-memory fake without touching the
// real Apple Books library.

export async function addBookToCollection(
  bookId: string,
  collectionId: string,
): Promise<{ success: boolean; message: string }> {
  const result = await productionMutation().mutate((tx) =>
    addBookToCollectionTx(tx, bookId, collectionId),
  );
  return mutationResultToLegacyShape(result, "Added book to collection.");
}

/**
 * Pure description of "add this book to this collection" against an open
 * LibraryTx. Throws MutationError for user-visible problems (book or
 * collection not found, already a member). Exported so tests can drive it
 * with fakes without touching the real Library on disk.
 */
export function addBookToCollectionTx(
  tx: LibraryTx,
  bookId: string,
  collectionId: string,
): { bookPk: number; collectionPk: number } {
  const numBookId = Number.parseInt(bookId, 10);
  const book = tx.query<{ Z_PK: number; ZASSETID: string }>(
    `SELECT Z_PK, ZASSETID FROM ${Tables.Books}
     WHERE ZASSETID = ? OR Z_PK = ?`,
    [bookId, Number.isNaN(numBookId) ? -1 : numBookId],
  );
  if (!book) throw new MutationError(`Book not found: ${bookId}`);

  const numCollId = Number.parseInt(collectionId, 10);
  const collection = tx.query<{ Z_PK: number }>(
    `SELECT Z_PK FROM ${Tables.Collections}
     WHERE ZCOLLECTIONID = ? OR Z_PK = ?`,
    [collectionId, Number.isNaN(numCollId) ? -1 : numCollId],
  );
  if (!collection) {
    throw new MutationError(`Collection not found: ${collectionId}`);
  }

  const existing = tx.query(
    `SELECT 1 FROM ${Tables.CollectionMembers}
     WHERE ZCOLLECTION = ? AND ZASSET = ?`,
    [collection.Z_PK, book.Z_PK],
  );
  if (existing) {
    throw new MutationError("Book is already in this collection");
  }

  const next = tx.query<{ k: number | null }>(
    `SELECT MAX(ZSORTKEY) AS k FROM ${Tables.CollectionMembers}
     WHERE ZCOLLECTION = ?`,
    [collection.Z_PK],
  );

  tx.insert(Tables.CollectionMembers, EntityTypes.CollectionMember, {
    ZSORTKEY: (next?.k ?? 0) + 1,
    ZASSET: book.Z_PK,
    ZCOLLECTION: collection.Z_PK,
    ZASSETID: book.ZASSETID,
  });

  // Bump parent Collection's mtime so Apple Books picks up the change on
  // next launch and iCloud syncs it. tx.update bakes in Z_OPT discipline.
  tx.update(Tables.Collections, collection.Z_PK, {});

  return { bookPk: book.Z_PK, collectionPk: collection.Z_PK };
}

function mutationResultToLegacyShape<T>(
  result: MutationResult<T>,
  successMessage: string,
): { success: boolean; message: string } {
  if (result.success) {
    return {
      success: true,
      message: `${successMessage} Database backup: ${result.backupPath}`,
    };
  }
  return { success: false, message: result.message };
}

// --- Legacy write helpers (still used by removeBookFromCollection,
// createCollection, and deleteCollection until those are migrated to
// LibraryMutation as well). ---

export async function removeBookFromCollection(
  bookId: string,
  collectionId: string,
): Promise<{ success: boolean; message: string }> {
  const result = await productionMutation().mutate((tx) =>
    removeBookFromCollectionTx(tx, bookId, collectionId),
  );
  return mutationResultToLegacyShape(result, "Removed book from collection.");
}

/**
 * Pure description of "remove this book from this collection" against an
 * open LibraryTx. Throws MutationError for user-visible problems.
 */
export function removeBookFromCollectionTx(
  tx: LibraryTx,
  bookId: string,
  collectionId: string,
): { bookPk: number; collectionPk: number } {
  const numBookId = Number.parseInt(bookId, 10);
  const book = tx.query<{ Z_PK: number }>(
    `SELECT Z_PK FROM ${Tables.Books}
     WHERE ZASSETID = ? OR Z_PK = ?`,
    [bookId, Number.isNaN(numBookId) ? -1 : numBookId],
  );
  if (!book) throw new MutationError(`Book not found: ${bookId}`);

  const numCollId = Number.parseInt(collectionId, 10);
  const collection = tx.query<{ Z_PK: number }>(
    `SELECT Z_PK FROM ${Tables.Collections}
     WHERE ZCOLLECTIONID = ? OR Z_PK = ?`,
    [collectionId, Number.isNaN(numCollId) ? -1 : numCollId],
  );
  if (!collection) {
    throw new MutationError(`Collection not found: ${collectionId}`);
  }

  const existing = tx.query<{ Z_PK: number }>(
    `SELECT Z_PK FROM ${Tables.CollectionMembers}
     WHERE ZCOLLECTION = ? AND ZASSET = ?`,
    [collection.Z_PK, book.Z_PK],
  );
  if (!existing) {
    throw new MutationError("Book is not in this collection");
  }

  tx.run(
    `DELETE FROM ${Tables.CollectionMembers}
     WHERE ZCOLLECTION = ? AND ZASSET = ?`,
    [collection.Z_PK, book.Z_PK],
  );

  // Bump parent Collection's mtime + Z_OPT for iCloud sync.
  tx.update(Tables.Collections, collection.Z_PK, {});

  return { bookPk: book.Z_PK, collectionPk: collection.Z_PK };
}

export async function createCollection(
  name: string,
): Promise<{ success: boolean; message: string; collectionId?: string }> {
  const result = await productionMutation().mutate((tx) =>
    createCollectionTx(tx, name),
  );
  if (result.success) {
    return {
      success: true,
      message: `Created collection "${name}". Database backup: ${result.backupPath}`,
      collectionId: result.data.collectionId,
    };
  }
  return { success: false, message: result.message };
}

/**
 * Pure description of "create a new collection named X" against an open
 * LibraryTx. Returns the freshly-allocated collection UUID so callers can
 * surface it.
 */
export function createCollectionTx(
  tx: LibraryTx,
  name: string,
): { collectionId: string; pk: number } {
  const collectionUuid = crypto.randomUUID().toUpperCase();

  const maxSort = tx.query<{ maxKey: number | null }>(
    `SELECT MAX(ZSORTKEY) as maxKey FROM ${Tables.Collections}`,
  );
  const sortKey = (maxSort?.maxKey ?? 0) + 1;

  const pk = tx.insert(Tables.Collections, EntityTypes.Collection, {
    ZDELETEDFLAG: 0,
    ZHIDDEN: 0,
    ZSORTKEY: sortKey,
    ZLASTMODIFICATION: coreDataNow(),
    ZCOLLECTIONID: collectionUuid,
    ZTITLE: name,
  });

  return { collectionId: collectionUuid, pk };
}

export async function deleteCollection(
  collectionId: string,
): Promise<{ success: boolean; message: string }> {
  const result = await productionMutation().mutate((tx) =>
    deleteCollectionTx(tx, collectionId),
  );
  return mutationResultToLegacyShape(result, "Deleted collection.");
}

/**
 * Pure description of "soft-delete this collection" against an open
 * LibraryTx. tx.softDelete bakes in ZDELETEDFLAG=1, mtime refresh, and the
 * Z_OPT bump that the previous implementation forgot.
 */
export function deleteCollectionTx(
  tx: LibraryTx,
  collectionId: string,
): { collectionPk: number } {
  const numCollId = Number.parseInt(collectionId, 10);
  const collection = tx.query<{ Z_PK: number }>(
    `SELECT Z_PK FROM ${Tables.Collections}
     WHERE ZCOLLECTIONID = ? OR Z_PK = ?`,
    [collectionId, Number.isNaN(numCollId) ? -1 : numCollId],
  );
  if (!collection) {
    throw new MutationError(`Collection not found: ${collectionId}`);
  }

  tx.softDelete(Tables.Collections, collection.Z_PK);
  return { collectionPk: collection.Z_PK };
}
