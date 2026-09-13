import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabaseConnection } from "../../src/db/connection.ts";
import {
  createFilesystemStore,
  type FilesystemStoreOptions,
} from "../../src/db/filesystem-store.ts";
import {
  validateAnnotationSchema,
  validateLibrarySchema,
} from "../../src/db/schema-check.ts";
import { createSeededAnnotationDb, createSeededDb } from "./seed.ts";

export function filesystemFixture(
  kind: "library" | "annotation" = "library",
  now?: () => number,
  overrides: Partial<FilesystemStoreOptions> = {},
  directoryPrefix = "books-storage-fixture-",
) {
  const dir = mkdtempSync(join(tmpdir(), directoryPrefix));
  const dbPath = join(
    dir,
    kind === "library" ? "BKLibrary-test.sqlite" : "AEAnnotation-test.sqlite",
  );
  const seed =
    kind === "library" ? createSeededDb() : createSeededAnnotationDb();
  writeFileSync(dbPath, seed.serialize());
  seed.close();
  const connection = createDatabaseConnection(() => dbPath);
  const openWritable = () => {
    const db = connection.get(false);
    db.run("PRAGMA wal_autocheckpoint=0");
    return db;
  };
  const close = connection.close;
  return {
    dir,
    dbPath,
    openWritable,
    close,
    store: createFilesystemStore({
      getDbPath: () => dbPath,
      openWritable,
      closeConnections: close,
      validateSchema:
        kind === "library" ? validateLibrarySchema : validateAnnotationSchema,
      now,
      ...overrides,
    }),
    cleanup() {
      close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
