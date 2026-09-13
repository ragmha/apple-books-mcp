import type { Database } from "bun:sqlite";
import { getLibraryDb } from "./connection.ts";
import { EntityTypes, Tables } from "./constants.ts";
import { coreDataNow } from "./core-data.ts";
import { resolveIdentifier } from "./identifiers.ts";
import {
  type LibraryTx,
  MutationError,
  type MutationResult,
} from "./library-mutation.ts";
import { productionMutation } from "./library-mutation-singleton.ts";
import { resolvePagination } from "./pagination.ts";
import { createDb } from "./query.ts";
import {
  type Book,
  BookSchema,
  type Collection,
  CollectionRowSchema,
  CollectionSchema,
} from "./schemas.ts";

function resolveCollection(rawDb: Database, collectionId: string) {
  const db = createDb(rawDb);
  const collection = resolveIdentifier(
    collectionId,
    "ZCOLLECTIONID",
    (predicate, params) =>
      db
        .selectFrom(Tables.Collections, CollectionRowSchema)
        .selectAll()
        .whereRaw(predicate, params)
        .get(),
  );
  return collection && (collection.ZDELETEDFLAG ?? 0) === 0 ? collection : null;
}

export function createCollectionQueries(getDatabase: () => Database) {
  function listCollections(limit?: number, offset?: number): Collection[] {
    const pagination = resolvePagination(limit, offset);
    const db = createDb(getDatabase());
    return db
      .selectFrom(Tables.Collections, CollectionSchema)
      .selectAll()
      .whereRaw("COALESCE(ZDELETEDFLAG, 0) = 0")
      .where("ZTITLE", "!=", "Sync Placeholder")
      .orderBy("ZSORTKEY")
      .orderBy("Z_PK")
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();
  }

  function getCollectionById(collectionId: string): Collection | null {
    const collection = resolveCollection(getDatabase(), collectionId);
    return collection ? CollectionSchema.parse(collection) : null;
  }

  function getCollectionBooks(
    collectionId: string,
    limit?: number,
    offset?: number,
  ): Book[] {
    const pagination = resolvePagination(limit, offset);
    const rawDb = getDatabase();
    const collection = resolveCollection(rawDb, collectionId);
    if (!collection) return [];

    // Use raw query for JOIN (query builder doesn't transform joined results well)
    const rows = rawDb
      .query(
        `SELECT a.* FROM ${Tables.Books} a
       JOIN ${Tables.CollectionMembers} cm ON cm.ZASSET = a.Z_PK
       WHERE cm.ZCOLLECTION = ?
       ORDER BY a.ZSORTTITLE ASC, a.Z_PK ASC, cm.Z_PK ASC
       LIMIT ? OFFSET ?`,
      )
      .all(collection.Z_PK, pagination.limit, pagination.offset);
    return rows.map((row) => BookSchema.parse(row));
  }

  return { listCollections, getCollectionById, getCollectionBooks };
}

export const { listCollections, getCollectionById, getCollectionBooks } =
  createCollectionQueries(getLibraryDb);

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

function resolveBookTx(tx: LibraryTx, id: string) {
  const book = resolveIdentifier(id, "ZASSETID", (predicate, params) =>
    tx.query<{ Z_PK: number; ZASSETID: string | null }>(
      `SELECT Z_PK, ZASSETID FROM ${Tables.Books} WHERE ${predicate}`,
      params,
    ),
  );
  if (!book) throw new MutationError(`Book not found: ${id}`);
  return book;
}

function resolveCollectionTx(tx: LibraryTx, id: string) {
  const collection = resolveIdentifier(
    id,
    "ZCOLLECTIONID",
    (predicate, params) =>
      tx.query<{ Z_PK: number; ZDELETEDFLAG: number | null }>(
        `SELECT Z_PK, ZDELETEDFLAG FROM ${Tables.Collections} WHERE ${predicate}`,
        params,
      ),
  );
  if (!collection) throw new MutationError(`Collection not found: ${id}`);
  if ((collection.ZDELETEDFLAG ?? 0) !== 0) {
    throw new MutationError(`Collection ${id} is already deleted.`);
  }
  return collection;
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
  const book = resolveBookTx(tx, bookId);
  const collection = resolveCollectionTx(tx, collectionId);

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
  const book = resolveBookTx(tx, bookId);
  const collection = resolveCollectionTx(tx, collectionId);

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
  const collection = resolveCollectionTx(tx, collectionId);

  tx.softDelete(Tables.Collections, collection.Z_PK);
  return { collectionPk: collection.Z_PK };
}
