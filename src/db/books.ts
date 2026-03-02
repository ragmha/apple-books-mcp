import { getLibraryDb } from "./connection.ts";
import type { BookRow } from "../types.ts";
import { bookFromRow, type Book } from "../types.ts";

export function listAllBooks(): Book[] {
  const db = getLibraryDb();
  const rows = db
    .query<BookRow, []>(
      `SELECT * FROM ZBKLIBRARYASSET
       WHERE ZCONTENTTYPE IS NOT NULL
       ORDER BY ZSORTTITLE ASC`
    )
    .all();
  return rows.map(bookFromRow);
}

export function getBookById(bookId: string): Book | null {
  const db = getLibraryDb();
  // Try by ZASSETID first, then by Z_PK
  let row = db
    .query<BookRow, [string]>(
      `SELECT * FROM ZBKLIBRARYASSET WHERE ZASSETID = ?`
    )
    .get(bookId);
  if (!row) {
    const numId = parseInt(bookId, 10);
    if (!isNaN(numId)) {
      row = db
        .query<BookRow, [number]>(
          `SELECT * FROM ZBKLIBRARYASSET WHERE Z_PK = ?`
        )
        .get(numId);
    }
  }
  return row ? bookFromRow(row) : null;
}

export function searchBooks(query: string): Book[] {
  const db = getLibraryDb();
  const pattern = `%${query}%`;
  const rows = db
    .query<BookRow, [string, string, string]>(
      `SELECT * FROM ZBKLIBRARYASSET
       WHERE ZTITLE LIKE ? OR ZAUTHOR LIKE ? OR ZGENRE LIKE ?
       ORDER BY ZSORTTITLE ASC`
    )
    .all(pattern, pattern, pattern);
  return rows.map(bookFromRow);
}
