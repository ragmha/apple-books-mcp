import { getLibraryDb } from "./connection.ts";
import { createDb } from "./query.ts";
import {
  BookSchema,
  BookSummarySchema,
  type Book,
  type BookSummary,
} from "./schemas.ts";
import { Tables } from "./constants.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function listBooks(
  limit?: number,
  offset?: number,
): { books: BookSummary[]; total: number; limit: number; offset: number } {
  const libDb = getLibraryDb();
  const db = createDb(libDb);

  const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const effectiveOffset = offset ?? 0;

  const total = libDb
    .query(
      `SELECT COUNT(*) as count FROM ${Tables.Books} WHERE ZCONTENTTYPE IS NOT NULL`,
    )
    .get() as { count: number };

  const books = db
    .selectFrom(Tables.Books, BookSummarySchema)
    .selectAll()
    .whereNotNull("ZCONTENTTYPE")
    .orderBy("ZSORTTITLE")
    .limit(effectiveLimit)
    .offset(effectiveOffset)
    .execute();

  return {
    books,
    total: total.count,
    limit: effectiveLimit,
    offset: effectiveOffset,
  };
}

export function listAllBooks(): Book[] {
  const db = createDb(getLibraryDb());
  return db
    .selectFrom(Tables.Books, BookSchema)
    .selectAll()
    .whereNotNull("ZCONTENTTYPE")
    .orderBy("ZSORTTITLE")
    .execute();
}

export function getBookById(bookId: string): Book | null {
  const db = createDb(getLibraryDb());

  // Try by ZASSETID first
  let book = db
    .selectFrom(Tables.Books, BookSchema)
    .selectAll()
    .where("ZASSETID", "=", bookId)
    .get();

  if (!book) {
    const numId = parseInt(bookId, 10);
    if (!isNaN(numId)) {
      book = db
        .selectFrom(Tables.Books, BookSchema)
        .selectAll()
        .where("Z_PK", "=", numId)
        .get();
    }
  }
  return book;
}

export function searchBooks(query: string): Book[] {
  const db = createDb(getLibraryDb());
  return db
    .selectFrom(Tables.Books, BookSchema)
    .selectAll()
    .whereLike("ZTITLE", query)
    .orWhereLike("ZAUTHOR", query)
    .orWhereLike("ZGENRE", query)
    .orderBy("ZSORTTITLE")
    .execute();
}
