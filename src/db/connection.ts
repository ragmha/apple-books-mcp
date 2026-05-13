import { Database } from "bun:sqlite";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Paths, DbPrefixes } from "./constants.ts";

function findSqliteFile(dir: string, prefix: string): string {
  if (!existsSync(dir)) {
    throw new Error(`Apple Books directory not found: ${dir}`);
  }
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".sqlite"))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (files.length === 0) {
    throw new Error(
      `No SQLite database found in ${dir} with prefix "${prefix}"`,
    );
  }
  return join(dir, files[0]!);
}

let libraryDb: Database | null = null;
let libraryDbReadonly: boolean | null = null;
let annotationDb: Database | null = null;
let annotationDbReadonly: boolean | null = null;

export function getLibraryDb(readonly = true): Database {
  if (libraryDb && libraryDbReadonly === readonly) return libraryDb;
  if (libraryDb) {
    libraryDb.close();
    libraryDb = null;
  }
  const dbPath = findSqliteFile(Paths.libraryDir, DbPrefixes.library);
  libraryDb = new Database(dbPath, { readonly });
  libraryDbReadonly = readonly;
  if (!readonly) {
    libraryDb.run("PRAGMA journal_mode=WAL");
  }
  return libraryDb;
}

export function getAnnotationDb(readonly = true): Database {
  if (annotationDb && annotationDbReadonly === readonly) return annotationDb;
  if (annotationDb) {
    annotationDb.close();
    annotationDb = null;
  }
  const dbPath = findSqliteFile(Paths.annotationDir, DbPrefixes.annotation);
  annotationDb = new Database(dbPath, { readonly });
  annotationDbReadonly = readonly;
  if (!readonly) {
    annotationDb.run("PRAGMA journal_mode=WAL");
  }
  return annotationDb;
}

/** Reopen library DB with write access for mutation operations */
export function getWritableLibraryDb(): Database {
  return getLibraryDb(false);
}

/** Reopen annotation DB with write access for mutation operations */
export function getWritableAnnotationDb(): Database {
  return getAnnotationDb(false);
}

export function closeAll(): void {
  if (libraryDb) {
    libraryDb.close();
    libraryDb = null;
    libraryDbReadonly = null;
  }
  if (annotationDb) {
    annotationDb.close();
    annotationDb = null;
    annotationDbReadonly = null;
  }
}

/** Get the path to the BKLibrary SQLite file (for backup purposes) */
export function getLibraryDbPath(): string {
  return findSqliteFile(Paths.libraryDir, DbPrefixes.library);
}

/** Get the path to the AEAnnotation SQLite file (for backup purposes) */
export function getAnnotationDbPath(): string {
  return findSqliteFile(Paths.annotationDir, DbPrefixes.annotation);
}
