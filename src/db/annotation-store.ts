import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { getAnnotationDbPath, getWritableAnnotationDb } from "./connection.ts";
import type { BackupInfo, LibraryStore } from "./library-mutation.ts";

const MAX_BACKUPS = 5;
const BACKUP_SUFFIX_RE = /\.backup-(\d+)$/;

/**
 * Production adapter for the AEAnnotation Core Data store. Implements the
 * same `LibraryStore` interface as the Library adapter — the `LibraryStore`
 * port is in fact "an Apple-Books-shaped SQLite store with a snapshot
 * lifecycle"; both Library and Annotations DBs match it.
 */
export const filesystemAnnotationStore: LibraryStore = {
  openWritable(): Database {
    return getWritableAnnotationDb();
  },

  snapshot(): string {
    const dbPath = getAnnotationDbPath();
    const backupPath = `${dbPath}.backup-${Date.now()}`;

    const db = getWritableAnnotationDb();
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");

    copyFileSync(dbPath, backupPath);

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
    const dbPath = getAnnotationDbPath();
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
    return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  restoreFromBackup(handle: string): void {
    const dbPath = getAnnotationDbPath();
    const expectedDir = dirname(dbPath);
    const expectedPrefix = `${basename(dbPath)}.backup-`;
    const resolved = resolve(handle);
    if (dirname(resolved) !== expectedDir) {
      throw new Error(
        "restoreFromBackup: handle is outside the backups directory",
      );
    }
    if (!basename(resolved).startsWith(expectedPrefix)) {
      throw new Error(
        "restoreFromBackup: handle does not look like an Annotations backup",
      );
    }
    if (!existsSync(resolved)) {
      throw new Error("restoreFromBackup: backup file not found");
    }
    copyFileSync(resolved, dbPath);
  },
};
