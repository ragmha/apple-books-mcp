import type { Database } from "bun:sqlite";
import { getLibraryDb } from "./connection.ts";
import { Tables } from "./constants.ts";
import { resolveIdentifier } from "./identifiers.ts";
import { resolvePagination } from "./pagination.ts";
import { createDb } from "./query.ts";
import {
  type Book,
  BookSchema,
  type BookSummary,
  BookSummarySchema,
} from "./schemas.ts";

const BOOKS_FILTER = "ZCONTENTTYPE IS NOT NULL";

export function createBookQueries(getDatabase: () => Database) {
  function listBooks(
    limit?: number,
    offset?: number,
  ): { books: BookSummary[]; total: number; limit: number; offset: number } {
    const pagination = resolvePagination(limit, offset);
    const libDb = getDatabase();
    const db = createDb(libDb);

    const total = libDb
      .query<{ count: number }, []>(
        `SELECT COUNT(*) as count FROM ${Tables.Books} WHERE ${BOOKS_FILTER}`,
      )
      .get();
    if (!total) throw new Error("Failed to count books");

    const books = db
      .selectFrom(Tables.Books, BookSummarySchema)
      .selectAll()
      .whereRaw(BOOKS_FILTER)
      .orderBy("ZSORTTITLE")
      .orderBy("Z_PK")
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();

    return {
      books,
      total: total.count,
      ...pagination,
    };
  }

  function listAllBooks(): Book[] {
    const db = createDb(getDatabase());
    return db
      .selectFrom(Tables.Books, BookSchema)
      .selectAll()
      .whereRaw(BOOKS_FILTER)
      .orderBy("ZSORTTITLE")
      .orderBy("Z_PK")
      .execute();
  }

  function getBookById(bookId: string): Book | null {
    const db = createDb(getDatabase());

    return resolveIdentifier(bookId, "ZASSETID", (predicate, params) =>
      db
        .selectFrom(Tables.Books, BookSchema)
        .selectAll()
        .whereRaw(predicate, params)
        .get(),
    );
  }

  function searchBooks(query: string, limit?: number, offset?: number): Book[] {
    const pagination = resolvePagination(limit, offset);
    const db = createDb(getDatabase());
    return db
      .selectFrom(Tables.Books, BookSchema)
      .selectAll()
      .whereLike("ZTITLE", query)
      .orWhereLike("ZAUTHOR", query)
      .orWhereLike("ZGENRE", query)
      .orderBy("ZSORTTITLE")
      .orderBy("Z_PK")
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();
  }

  return { listBooks, listAllBooks, getBookById, searchBooks };
}

export const { listBooks, listAllBooks, getBookById, searchBooks } =
  createBookQueries(getLibraryDb);
