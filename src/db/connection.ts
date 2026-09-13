import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DbPrefixes, Paths } from "./constants.ts";

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
  const [file] = files;
  if (file === undefined) {
    throw new Error(
      `No SQLite database found in ${dir} with prefix "${prefix}"`,
    );
  }
  return join(dir, file);
}

export function openDatabase(path: string, readonly: boolean): Database {
  return new Database(path, { readonly, readwrite: !readonly, create: false });
}

export function createDatabaseConnection(
  getDbPath: () => string,
  open = openDatabase,
) {
  let cached: { db: Database; readonly: boolean } | undefined;

  function close(): void {
    const previous = cached;
    cached = undefined;
    previous?.db.close();
  }

  return {
    get(readonly = true): Database {
      if (cached?.readonly === readonly) return cached.db;
      close();
      const db = open(getDbPath(), readonly);
      try {
        if (!readonly) {
          const row = db
            .query<{ journal_mode: string }, []>("PRAGMA journal_mode=WAL")
            .get();
          if (row?.journal_mode !== "wal") {
            throw new Error("Could not enable SQLite WAL mode.");
          }
        }
        cached = { db, readonly };
        return db;
      } catch (error) {
        try {
          db.close();
        } catch (closeError) {
          console.error("SQLite connection setup cleanup failed:", closeError);
        }
        throw error;
      }
    },
    close,
  };
}

const libraryConnection = createDatabaseConnection(getLibraryDbPath);
const annotationConnection = createDatabaseConnection(getAnnotationDbPath);

export function getLibraryDb(readonly = true): Database {
  return libraryConnection.get(readonly);
}

export function getAnnotationDb(readonly = true): Database {
  return annotationConnection.get(readonly);
}

export function closeLibraryDb(): void {
  libraryConnection.close();
}

export function closeAnnotationDb(): void {
  annotationConnection.close();
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
  const errors: unknown[] = [];
  for (const connection of [libraryConnection, annotationConnection]) {
    try {
      connection.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "SQLite cleanup failed.");
}

/** Get the path to the BKLibrary SQLite file (for backup purposes) */
export function getLibraryDbPath(): string {
  return findSqliteFile(Paths.libraryDir, DbPrefixes.library);
}

/** Get the path to the AEAnnotation SQLite file (for backup purposes) */
export function getAnnotationDbPath(): string {
  return findSqliteFile(Paths.annotationDir, DbPrefixes.annotation);
}
