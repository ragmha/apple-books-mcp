import { Database } from "bun:sqlite";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BOOKS_CONTAINER = join(
  homedir(),
  "Library/Containers/com.apple.iBooksX/Data/Documents"
);

const BKLIBRARY_DIR = join(BOOKS_CONTAINER, "BKLibrary");
const AEANNOTATION_DIR = join(BOOKS_CONTAINER, "AEAnnotation");

function findSqliteFile(dir: string, prefix: string): string {
  if (!existsSync(dir)) {
    throw new Error(`Apple Books directory not found: ${dir}`);
  }
  const files = readdirSync(dir).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".sqlite")
  );
  if (files.length === 0) {
    throw new Error(`No SQLite database found in ${dir} with prefix "${prefix}"`);
  }
  return join(dir, files[0]!);
}

let libraryDb: Database | null = null;
let annotationDb: Database | null = null;

export function getLibraryDb(readonly = true): Database {
  if (libraryDb) return libraryDb;
  const dbPath = findSqliteFile(BKLIBRARY_DIR, "BKLibrary");
  libraryDb = new Database(dbPath, { readonly });
  libraryDb.exec("PRAGMA journal_mode=WAL");
  return libraryDb;
}

export function getAnnotationDb(): Database {
  if (annotationDb) return annotationDb;
  const dbPath = findSqliteFile(AEANNOTATION_DIR, "AEAnnotation");
  annotationDb = new Database(dbPath, { readonly: true });
  annotationDb.exec("PRAGMA journal_mode=WAL");
  return annotationDb;
}

/** Reopen library DB with write access for mutation operations */
export function getWritableLibraryDb(): Database {
  if (libraryDb) {
    libraryDb.close();
    libraryDb = null;
  }
  const dbPath = findSqliteFile(BKLIBRARY_DIR, "BKLibrary");
  libraryDb = new Database(dbPath, { readonly: false });
  libraryDb.exec("PRAGMA journal_mode=WAL");
  return libraryDb;
}

export function closeAll(): void {
  if (libraryDb) {
    libraryDb.close();
    libraryDb = null;
  }
  if (annotationDb) {
    annotationDb.close();
    annotationDb = null;
  }
}

/** Get the path to the BKLibrary SQLite file (for backup purposes) */
export function getLibraryDbPath(): string {
  return findSqliteFile(BKLIBRARY_DIR, "BKLibrary");
}
