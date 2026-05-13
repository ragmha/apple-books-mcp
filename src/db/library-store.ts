import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { getLibraryDbPath, getWritableLibraryDb } from "./connection.ts";
import type { BackupInfo, LibraryStore } from "./library-mutation.ts";

const MAX_BACKUPS = 5;
const BACKUP_SUFFIX_RE = /\.backup-(\d+)$/;

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

  listBackups(): BackupInfo[] {
    const dbPath = getLibraryDbPath();
    const dir = dirname(dbPath);
    const dbName = basename(dbPath);
    const prefix = `${dbName}.backup-`;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    const result: BackupInfo[] = [];
    for (const name of entries) {
      if (!name.startsWith(prefix)) continue;
      const match = BACKUP_SUFFIX_RE.exec(name);
      if (!match) continue;
      const millis = Number(match[1]);
      if (!Number.isFinite(millis)) continue;
      const handle = join(dir, name);
      let sizeBytes = 0;
      try {
        sizeBytes = statSync(handle).size;
      } catch {
        continue;
      }
      result.push({
        handle,
        createdAt: new Date(millis).toISOString(),
        sizeBytes,
      });
    }
    // Newest first.
    return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  restoreFromBackup(handle: string): void {
    const dbPath = getLibraryDbPath();
    const expectedDir = dirname(dbPath);
    const expectedPrefix = `${basename(dbPath)}.backup-`;
    // Resolve to an absolute path and require the file live in the expected
    // backups directory with the expected name shape. This blocks the
    // "user passes /etc/passwd as a handle" footgun and any naive path
    // traversal.
    const resolved = resolve(handle);
    if (dirname(resolved) !== expectedDir) {
      throw new Error(
        "restoreFromBackup: handle is outside the backups directory",
      );
    }
    if (!basename(resolved).startsWith(expectedPrefix)) {
      throw new Error(
        "restoreFromBackup: handle does not look like a Library backup",
      );
    }
    if (!existsSync(resolved)) {
      throw new Error("restoreFromBackup: backup file not found");
    }
    copyFileSync(resolved, dbPath);
  },
};
