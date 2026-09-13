import type { Database } from "bun:sqlite";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { openDatabase } from "./connection.ts";
import {
  type BackupInfo,
  type LibraryStore,
  RestoreFailure,
  type RestoreLease,
} from "./library-mutation.ts";
import type { SchemaCheckResult } from "./schema-check.ts";
import {
  openSqliteRestore,
  type SqliteRestoreConnection,
} from "./sqlite-restore.ts";

export interface FilesystemStoreOperations {
  openDatabase: typeof openDatabase;
  publishFile(source: string, destination: string): void;
  removeBackup(path: string): void;
  openRestore: typeof openSqliteRestore;
}

export interface FilesystemStoreOptions {
  getDbPath(): string;
  openWritable(): Database;
  closeConnections(): void;
  validateSchema(db: Database): SchemaCheckResult;
  now?: () => number;
  operations?: Partial<FilesystemStoreOperations>;
}

const MAX_BACKUPS = 5;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function createFilesystemStore({
  getDbPath,
  openWritable,
  closeConnections,
  validateSchema,
  now = Date.now,
  operations = {},
}: FilesystemStoreOptions): LibraryStore {
  const ops: FilesystemStoreOperations = {
    openDatabase,
    publishFile: linkSync,
    removeBackup: unlinkSync,
    openRestore: openSqliteRestore,
    ...operations,
  };
  let lastMillis = 0;
  const pinned = new Set<string>();

  function backupMillis(name: string, dbName: string): number | undefined {
    const prefix = `${dbName}.backup-`;
    if (!name.startsWith(prefix)) return undefined;
    const suffix = name.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) return undefined;
    const millis = Number(suffix);
    if (!Number.isSafeInteger(millis) || millis > 8_640_000_000_000_000) {
      return undefined;
    }
    return millis;
  }

  function scopedHandle(handle: string): string {
    const dbPath = resolve(getDbPath());
    const path = resolve(handle);
    if (
      dirname(path) !== dirname(dbPath) ||
      backupMillis(basename(path), basename(dbPath)) === undefined
    ) {
      throw new Error("Backup handle is outside this store.");
    }
    return path;
  }

  function requireNoSidecars(path: string): void {
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      try {
        lstatSync(`${path}${suffix}`);
      } catch (error) {
        if (hasCode(error, "ENOENT")) continue;
        throw error;
      }
      throw new Error("Backup has SQLite sidecars and is not standalone.");
    }
  }

  function checkedHandle(handle: string): string {
    const path = scopedHandle(handle);
    if (!lstatSync(path).isFile()) {
      throw new Error("Backup is not a regular file.");
    }
    requireNoSidecars(path);
    return path;
  }

  function listBackups(): BackupInfo[] {
    const dbPath = resolve(getDbPath());
    const dir = dirname(dbPath);
    const result: BackupInfo[] = [];
    for (const name of readdirSync(dir)) {
      const millis = backupMillis(name, basename(dbPath));
      if (millis === undefined) continue;
      const handle = join(dir, name);
      try {
        const info = lstatSync(handle);
        if (!info.isFile()) continue;
        result.push({
          handle,
          createdAt: new Date(millis).toISOString(),
          sizeBytes: info.size,
        });
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
    }
    return result.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }

  function withDatabase<T>(
    path: string,
    readonly: boolean,
    action: (db: Database) => T,
  ): T {
    let db: Database | undefined;
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      db = ops.openDatabase(path, readonly);
      outcome = { ok: true, value: action(db) };
    } catch (error) {
      outcome = { ok: false, error };
    }
    if (db) {
      try {
        db.close();
      } catch (error) {
        console.error("Filesystem store: backup close failed:", error);
        if (outcome.ok) outcome = { ok: false, error };
      }
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  function validate(db: Database): void {
    const rows = db
      .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
      .all();
    if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") {
      throw new Error("SQLite integrity check failed.");
    }
    const schema = validateSchema(db);
    if (!schema.ok) throw new Error(schema.message);
  }

  function normalizeStaged(path: string): void {
    withDatabase(path, false, (db) => {
      const row = db
        .query<{ journal_mode: string }, []>("PRAGMA journal_mode=DELETE")
        .get();
      if (row?.journal_mode !== "delete") {
        throw new Error("Snapshot could not be made standalone.");
      }
    });
    withDatabase(path, true, validate);
    chmodSync(path, 0o400);
  }

  function cleanupStaging(dir: string): void {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      console.error("Filesystem store: staging cleanup failed:", error);
    }
  }

  function stagingDir(): string {
    return mkdtempSync(join(dirname(resolve(getDbPath())), ".books-snapshot-"));
  }

  function stageBackup(handle: string, target: string): void {
    const path = checkedHandle(handle);
    let source: number | undefined;
    let destination: number | undefined;
    let failure: { error: unknown } | undefined;
    try {
      source = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const before = fstatSync(source, { bigint: true });
      if (!before.isFile()) throw new Error("Backup is not a regular file.");
      destination = openSync(target, "wx", 0o600);
      const buffer = Buffer.alloc(64 * 1024);
      let length = readSync(source, buffer, 0, buffer.length, null);
      while (length) {
        let offset = 0;
        while (offset < length) {
          const written = writeSync(
            destination,
            buffer,
            offset,
            length - offset,
          );
          if (!written) throw new Error("Could not finish staging the backup.");
          offset += written;
        }
        length = readSync(source, buffer, 0, buffer.length, null);
      }
      const after = fstatSync(source, { bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
        throw new Error("Backup changed while being read.");
      }
      requireNoSidecars(path);
    } catch (error) {
      failure = { error };
    } finally {
      for (const fd of [destination, source]) {
        if (fd === undefined) continue;
        try {
          closeSync(fd);
        } catch (error) {
          failure ??= { error };
          console.error("Filesystem store: backup file close failed:", error);
        }
      }
    }
    if (failure) throw failure.error;
    // Legacy numeric handles may contain a WAL-mode header but no sidecars.
    // Normalize only this private copy, never the published backup.
    normalizeStaged(target);
  }

  function verifySnapshot(handle: string): boolean {
    let dir: string | undefined;
    try {
      checkedHandle(handle);
      dir = stagingDir();
      stageBackup(handle, join(dir, "verify.sqlite"));
      return true;
    } catch (error) {
      console.error("Filesystem store: backup verification failed:", error);
      return false;
    } finally {
      if (dir) cleanupStaging(dir);
    }
  }

  function prune(): void {
    try {
      for (const old of listBackups().slice(MAX_BACKUPS)) {
        if (pinned.has(old.handle)) continue;
        try {
          ops.removeBackup(old.handle);
        } catch (error) {
          console.error("Filesystem store: backup pruning failed:", error);
        }
      }
    } catch (error) {
      console.error(
        "Filesystem store: backup enumeration for pruning failed:",
        error,
      );
    }
  }

  function publish(staged: string): string {
    const dbPath = resolve(getDbPath());
    const newest = listBackups()[0];
    let millis = Math.max(
      now(),
      lastMillis + 1,
      newest ? Date.parse(newest.createdAt) + 1 : 0,
    );
    syncPath(staged);
    for (let attempts = 0; attempts < 100; attempts++, millis++) {
      if (
        !Number.isSafeInteger(millis) ||
        millis < 0 ||
        millis > 8_640_000_000_000_000
      ) {
        throw new Error("Cannot allocate a valid backup timestamp.");
      }
      const handle = `${dbPath}.backup-${millis}`;
      try {
        // link(2) publishes the already-verified artifact without overwriting.
        ops.publishFile(staged, handle);
        syncPath(dirname(handle));
        lastMillis = millis;
        return handle;
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
    }
    throw new Error("Could not reserve a unique backup handle.");
  }

  function syncPath(path: string): void {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let failure: { error: unknown } | undefined;
    try {
      fsyncSync(fd);
    } catch (error) {
      failure = { error };
    } finally {
      try {
        closeSync(fd);
      } catch (error) {
        console.error("Filesystem store: sync handle close failed:", error);
        failure ??= { error };
      }
    }
    if (failure) throw failure.error;
  }

  function validatedWritable(): Database {
    const db = openWritable();
    const schema = validateSchema(db);
    if (!schema.ok) {
      try {
        closeConnections();
      } catch (error) {
        console.error(
          "Filesystem store: invalid connection cleanup failed:",
          error,
        );
      }
      throw new Error(schema.message);
    }
    return db;
  }

  function snapshot(): string {
    const dir = stagingDir();
    try {
      const staged = join(dir, "snapshot.sqlite");
      validatedWritable().run("VACUUM main INTO ?", [staged]);
      normalizeStaged(staged);
      const handle = publish(staged);
      prune();
      return handle;
    } finally {
      cleanupStaging(dir);
    }
  }

  async function prepareRestore(handle: string): Promise<RestoreLease> {
    const selected = checkedHandle(handle);
    const dir = stagingDir();
    const target = join(dir, "selected.sqlite");
    const safety = join(dir, "safety.sqlite");
    let connection: SqliteRestoreConnection | undefined;
    let safetyHandle: string | undefined;
    let retainRecovery = false;
    let closed = false;
    let verifiedCopies = 0;
    pinned.add(selected);
    try {
      stageBackup(selected, target);
      closeConnections();
      connection = await ops.openRestore(resolve(getDbPath()), dir);
    } catch (error) {
      pinned.delete(selected);
      cleanupStaging(dir);
      throw error;
    }
    const sqlite = connection;

    async function verifyLive(): Promise<void> {
      if (!(await sqlite.verify()))
        throw new Error("Restored integrity check failed.");
      const copy = join(dir, `verify-restored-${++verifiedCopies}.sqlite`);
      await sqlite.snapshot(copy);
      normalizeStaged(copy);
    }

    return {
      async snapshot() {
        if (closed || safetyHandle) {
          throw new Error("Restore lease cannot take another safety snapshot.");
        }
        await sqlite.snapshot(safety);
        normalizeStaged(safety);
        safetyHandle = publish(safety);
        pinned.add(safetyHandle);
        prune();
        return safetyHandle;
      },
      async restoreFromBackup() {
        if (closed || !safetyHandle) {
          throw new Error("Restore requires a verified safety snapshot.");
        }
        withDatabase(target, true, validate);
        withDatabase(safety, true, validate);
        try {
          await sqlite.restore(target);
          await verifyLive();
        } catch (error) {
          retainRecovery = true;
          console.error("Filesystem store: SQLite restore failed:", error);
          try {
            withDatabase(safety, true, validate);
            await sqlite.restore(safety);
            await verifyLive();
          } catch (recoveryError) {
            console.error("Filesystem store: recovery failed:", recoveryError);
            throw new RestoreFailure(false, { cause: error });
          }
          throw new RestoreFailure(true, { cause: error });
        }
      },
      async close() {
        if (closed) return;
        closed = true;
        let failure: unknown;
        try {
          closeConnections();
        } catch (error) {
          failure = error;
        }
        try {
          await sqlite.close();
        } catch (error) {
          failure ??= error;
        }
        try {
          closeConnections();
        } catch (error) {
          failure ??= error;
        } finally {
          if (!retainRecovery && !failure) {
            pinned.delete(selected);
            if (safetyHandle) pinned.delete(safetyHandle);
          }
          cleanupStaging(dir);
        }
        if (failure) throw failure;
      },
    };
  }

  return {
    openWritable: validatedWritable,
    snapshot,
    verifySnapshot,
    listBackups,
    prepareRestore,
    async restoreFromBackup(handle) {
      const lease = await prepareRestore(handle);
      let failure: { error: unknown } | undefined;
      try {
        await lease.snapshot();
        await lease.restoreFromBackup();
      } catch (error) {
        failure = { error };
      } finally {
        try {
          await lease.close();
        } catch (error) {
          console.error("Filesystem store: restore cleanup failed:", error);
          failure ??= { error };
        }
      }
      if (failure) throw failure.error;
    },
  };
}
