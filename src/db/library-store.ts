import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  getLibraryDbPath,
  getWritableLibraryDb,
} from "./connection.ts";
import type { LibraryStore } from "./library-mutation.ts";

const MAX_BACKUPS = 5;

/**
 * Production adapter that opens the real Apple Books library file.
 *
 * - `openWritable` reuses the existing connection module (which handles
 *   read/write mode switching and WAL).
 * - `snapshot` runs a WAL checkpoint, copies the .sqlite file alongside the
 *   original with a `.backup-<timestamp>` suffix, and rotates older backups
 *   to keep at most `MAX_BACKUPS`. Returns the backup file path.
 * - `verifySnapshot` opens the snapshot read-only and runs
 *   `PRAGMA integrity_check`.
 */
export const filesystemLibraryStore: LibraryStore = {
  openWritable(): Database {
    return getWritableLibraryDb();
  },

  snapshot(): string {
    const dbPath = getLibraryDbPath();
    const backupPath = `${dbPath}.backup-${Date.now()}`;

    const db = getWritableLibraryDb();
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");

    copyFileSync(dbPath, backupPath);

    // Rotate: keep the MAX_BACKUPS most-recent backups, delete the rest.
    const dir = dirname(dbPath);
    const dbName = basename(dbPath);
    const backups = readdirSync(dir)
      .filter((f) => f.startsWith(`${dbName}.backup-`))
      .sort()
      .reverse();
    for (const old of backups.slice(MAX_BACKUPS)) {
      try {
        unlinkSync(join(dir, old));
      } catch {
        // Best-effort cleanup; rotation failure should not fail the mutation.
      }
    }

    return backupPath;
  },

  verifySnapshot(handle: string): boolean {
    if (!existsSync(handle)) return false;
    const snap = new Database(handle, { readonly: true });
    try {
      const row = snap
        .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
        .get();
      return row?.integrity_check === "ok";
    } catch {
      return false;
    } finally {
      snap.close();
    }
  },
};
