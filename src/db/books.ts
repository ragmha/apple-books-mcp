import { getLibraryDb } from "./connection.ts";
import { createDb } from "./query.ts";
import { BookSchema, type Book } from "./schemas.ts";
import { Tables } from "./constants.ts";

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
