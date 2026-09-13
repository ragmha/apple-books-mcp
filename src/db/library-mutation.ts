import type { Database } from "bun:sqlite";
import { coreDataNow } from "./core-data.ts";

/**
 * The handle the caller receives inside a `mutate` callback. Exposes
 * Core Data row helpers (`insert` / `update` / `softDelete`) that bake in
 * Z_PK / Z_ENT / Z_OPT / mtime discipline, plus `query` / `run` for the rest.
 *
 * Callers must NOT issue BEGIN / COMMIT / ROLLBACK on this handle; the
 * surrounding `mutate` owns transaction boundaries.
 */
export interface LibraryTx {
  /** Execute a SQL statement that returns no rows. */
  run(sql: string, params?: unknown[]): void;

  /** Fetch zero-or-one row. Returns `null` if no row matches. */
  query<R>(sql: string, params?: unknown[]): R | null;

  /** Fetch all matching rows. */
  queryAll<R>(sql: string, params?: unknown[]): R[];

  /**
   * Insert a Core Data row. Allocates the next Z_PK from Z_PRIMARYKEY
   * atomically, sets Z_ENT to `entity`, Z_OPT to 1, and ZLOCALMODDATE to the
   * current Core Data timestamp. Returns the allocated Z_PK.
   *
   * Caller provides domain columns only; the Core Data discipline columns
   * are managed by this method and must not appear in `columns`.
   */
  insert(
    table: string,
    entity: number,
    columns: Record<string, unknown>,
  ): number;

  /**
   * Update a row by Z_PK. Increments Z_OPT, refreshes ZLOCALMODDATE, and
   * applies the supplied columns. Caller must not include Z_OPT or
   * ZLOCALMODDATE in `columns`.
   */
  update(table: string, pk: number, columns: Record<string, unknown>): void;

  /**
   * Soft-delete a row by Z_PK. Sets ZDELETEDFLAG = 1, refreshes both
   * ZLASTMODIFICATION and ZLOCALMODDATE, and increments Z_OPT.
   */
  softDelete(table: string, pk: number): void;
}

/** Throw inside a `mutate` callback to fail with a user-facing message. */
export class MutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationError";
  }
}

/** Outcome of a `mutate` call. */
export type MutationResult<T> =
  | { success: true; data: T; message: string; backupPath: string }
  | { success: false; message: string; backupPath?: string };

export interface MutationOptions {
  /** Skip relaunching Books.app after a successful COMMIT. Use when chaining. */
  skipRestart?: boolean;
}

/** Caller's described change. May be sync or async. */
export type LibraryTxFn<T> = (tx: LibraryTx) => Promise<T> | T;

/**
 * The seam over the Library's filesystem and lifecycle. Production opens
 * the real `~/Library/Containers/...` files; tests hand out an in-memory DB.
 */
export interface LibraryStore {
  /** Hand out a writable Database handle for the duration of one mutation. */
  openWritable(): Database;

  /** Snapshot the Library to a stable handle (path-or-token). */
  snapshot(): string;

  /** Verify a snapshot's integrity (production: PRAGMA integrity_check). */
  verifySnapshot(handle: string): boolean;

  /** Enumerate the rotated backups this store has previously taken. */
  listBackups(): BackupInfo[];

  /** Restore through SQLite, never by replacing an open database's bytes. */
  restoreFromBackup(handle: string): void | Promise<void>;

  /** Hold exclusive SQLite ownership across the complete restore ceremony. */
  prepareRestore?(handle: string): Promise<RestoreLease>;
}

export interface RestoreLease {
  snapshot(): Promise<string>;
  restoreFromBackup(): Promise<void>;
  close(): Promise<void>;
}

export class RestoreUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "Restore requires the macOS SQLite command-line tool at /usr/bin/sqlite3; it could not be started.",
      options,
    );
  }
}

/** A storage failure with an explicitly-known recovery outcome. */
export class RestoreFailure extends Error {
  constructor(
    readonly recovered: boolean,
    options?: ErrorOptions,
  ) {
    super(
      recovered
        ? "Restore failed; the verified pre-restore state was recovered."
        : "Restore failed and recovery could not be verified. Keep Books.app closed and recover from the safety snapshot.",
      options,
    );
  }
}

/** Metadata about one rotated backup of the Library. */
export interface BackupInfo {
  /**
   * Opaque handle that can be passed back to `verifySnapshot` and
   * `restoreFromBackup`. In production this is the absolute file path.
   */
  handle: string;
  /** ISO-8601 timestamp parsed from the backup file name. */
  createdAt: string;
  /** File size in bytes. */
  sizeBytes: number;
}

/** The seam over the macOS Books application. */
export interface BooksAppPort {
  isRunning(): Promise<boolean>;
  quit(): Promise<void>;
  launch(): Promise<void>;
}

export interface LibraryMutation {
  mutate<T>(
    fn: LibraryTxFn<T>,
    options?: MutationOptions,
  ): Promise<MutationResult<T>>;

  /** Enumerate previously-taken backups, newest first. */
  listBackups(): BackupInfo[];

  /**
   * Restore the live Library from a previously-taken backup, with the same
   * safety ceremony as `mutate`: verify integrity → quit Books → take a
   * verified pre-restore safety snapshot → SQLite restore → verify → relaunch.
   *
   * Returns a structured `RestoreResult` rather than throwing — the same
   * sanitisation rules as `mutate` apply, so raw error text never reaches
   * the caller.
   */
  restore(handle: string): Promise<RestoreResult>;
}

/** Outcome of a `restore` call. */
export type RestoreResult =
  | {
      success: true;
      restoredFrom: string;
      safetyBackupPath: string;
      message: string;
    }
  | { success: false; message: string; safetyBackupPath?: string };

export function createLibraryMutation(
  store: LibraryStore,
  booksApp: BooksAppPort,
): LibraryMutation {
  async function restore(handle: string): Promise<RestoreResult> {
    let safetyBackupPath: string | undefined;
    let lease: RestoreLease | undefined;
    let phase = "backup integrity verification";
    let restored = false;
    let failure: unknown;
    let cleanupFailed = false;
    try {
      if (!store.verifySnapshot(handle)) {
        return {
          success: false,
          message: `Backup ${handle} failed integrity check; aborted before any change.`,
        };
      }
      phase = "quit Books.app";
      if (await booksApp.isRunning()) {
        await booksApp.quit();
      }
      phase = "exclusive restore setup";
      lease = await store.prepareRestore?.(handle);
      phase = "pre-restore safety snapshot";
      safetyBackupPath = lease ? await lease.snapshot() : store.snapshot();
      if (!store.verifySnapshot(safetyBackupPath)) {
        return {
          success: false,
          message:
            "Pre-restore safety snapshot failed integrity check; aborted before restoring.",
          safetyBackupPath,
        };
      }
      phase = "file swap";
      if (lease) await lease.restoreFromBackup();
      else await store.restoreFromBackup(handle);
      restored = true;
    } catch (error) {
      failure = error;
      console.error(`LibraryMutation.restore: ${phase} failed:`, error);
    } finally {
      if (lease) {
        try {
          await lease.close();
        } catch (error) {
          cleanupFailed = true;
          console.error(
            "LibraryMutation.restore: lease cleanup failed:",
            error,
          );
        }
      }
    }
    if (!restored || cleanupFailed || !safetyBackupPath) {
      let message =
        failure instanceof RestoreFailure ||
        failure instanceof RestoreUnavailableError
          ? failure.message
          : `Operation failed during ${phase}.`;
      if (restored && cleanupFailed) {
        message =
          "Restore was committed and verified, but connection cleanup failed. Books.app was not relaunched.";
      }
      if (safetyBackupPath) {
        message += ` Pre-restore safety snapshot saved at ${safetyBackupPath}.`;
      }
      return { success: false, message, safetyBackupPath };
    }
    let launchWarning = "";
    try {
      await booksApp.launch();
    } catch (error) {
      console.error(
        "LibraryMutation.restore: launch failed after restore:",
        error,
      );
      launchWarning = " Reopen Books.app manually.";
    }
    return {
      success: true,
      restoredFrom: handle,
      safetyBackupPath,
      message: `Restored Library from ${handle}. Pre-restore safety snapshot saved at ${safetyBackupPath}.${launchWarning}`,
    };
  }

  async function mutate<T>(
    fn: LibraryTxFn<T>,
    options?: MutationOptions,
  ): Promise<MutationResult<T>> {
    let backupPath: string | undefined;
    let db: Database | undefined;
    let transactionActive = false;
    let phase = "snapshot the Library";
    try {
      backupPath = store.snapshot();
      phase = "verify the snapshot";
      if (!store.verifySnapshot(backupPath)) {
        return {
          success: false,
          message: `Backup integrity check failed; aborted before any change. Backup: ${backupPath}`,
          backupPath,
        };
      }
      phase = "quit Books.app";
      if (await booksApp.isRunning()) {
        await booksApp.quit();
      }
      phase = "open the writable Library";
      db = store.openWritable();
      phase = "begin the transaction";
      db.run("BEGIN IMMEDIATE");
      transactionActive = true;
      phase = "apply the mutation";
      const data = await fn(makeTx(db));
      phase = "confirm the commit";
      db.run("COMMIT");
      transactionActive = false;
      let launchWarning = "";
      if (!options?.skipRestart) {
        try {
          await booksApp.launch();
        } catch (error) {
          console.error("LibraryMutation: launch failed after COMMIT:", error);
          launchWarning = " Reopen Books.app manually.";
        }
      }
      return {
        success: true,
        data,
        message: `Mutation applied successfully.${launchWarning}`,
        backupPath,
      };
    } catch (error) {
      if (transactionActive && db) {
        try {
          db.run("ROLLBACK");
        } catch (rollbackError) {
          console.error(
            "LibraryMutation: ROLLBACK cleanup failed:",
            rollbackError,
          );
        }
      }
      if (phase === "apply the mutation" && error instanceof MutationError) {
        return { success: false, message: error.message, backupPath };
      }
      console.error(`LibraryMutation: could not ${phase}:`, error);
      return {
        success: false,
        message: `Operation failed: could not ${phase}.${backupPath ? ` Backup: ${backupPath}` : ""}`,
        backupPath,
      };
    }
  }

  return {
    listBackups() {
      return store.listBackups();
    },
    restore(handle) {
      return coordinateBooksApp(booksApp, () => restore(handle));
    },
    mutate(fn, options) {
      return coordinateBooksApp(booksApp, () => mutate(fn, options));
    },
  };
}

const appOperations = new WeakMap<BooksAppPort, Promise<void>>();

function coordinateBooksApp<T>(
  booksApp: BooksAppPort,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = appOperations.get(booksApp) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  appOperations.set(booksApp, tail);
  void tail.then(() => {
    if (appOperations.get(booksApp) === tail) appOperations.delete(booksApp);
  });
  return result;
}

function makeTx(db: import("bun:sqlite").Database): LibraryTx {
  function allocatePk(entity: number): number {
    // UPDATE … RETURNING is atomic in SQLite 3.35+ (Bun ships >= 3.45).
    // This kills the UPDATE-then-SELECT race that the previous codebase had.
    const row = db
      .query<{ Z_MAX: number }, [number]>(
        "UPDATE Z_PRIMARYKEY SET Z_MAX = Z_MAX + 1 WHERE Z_ENT = ? RETURNING Z_MAX",
      )
      .get(entity);
    if (!row) {
      throw new Error(
        `LibraryTx.insert: no Z_PRIMARYKEY row for entity ${entity}; ` +
          "Apple Books schema may have changed.",
      );
    }
    return row.Z_MAX;
  }

  return {
    run(sql, params) {
      if (params) db.run(sql, params as never);
      else db.run(sql);
    },
    query(sql, params) {
      const stmt = db.query(sql);
      const row = (params ? stmt.get(...(params as never[])) : stmt.get()) as
        | unknown
        | null;
      return (row ?? null) as never;
    },
    queryAll(sql, params) {
      const stmt = db.query(sql);
      return (params ? stmt.all(...(params as never[])) : stmt.all()) as never;
    },
    insert(table, entity, columns) {
      const pk = allocatePk(entity);
      const now = coreDataNow();
      const allColumns: Record<string, unknown> = {
        Z_PK: pk,
        Z_ENT: entity,
        Z_OPT: 1,
        ZLOCALMODDATE: now,
        ...columns,
      };
      const cols = Object.keys(allColumns);
      const placeholders = cols.map(() => "?").join(", ");
      db.run(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`,
        cols.map((c) => allColumns[c]) as never,
      );
      return pk;
    },
    update(table, pk, columns) {
      const now = coreDataNow();
      const cols = Object.keys(columns);
      // Z_OPT and ZLOCALMODDATE are managed by us — caller must not pass them.
      // Z_OPT bump uses a SET fragment (not a bound param) so it stays atomic.
      const sets = [
        ...cols.map((c) => `${c} = ?`),
        "Z_OPT = Z_OPT + 1",
        "ZLOCALMODDATE = ?",
      ];
      const params = [...cols.map((c) => columns[c]), now, pk];
      db.run(
        `UPDATE ${table} SET ${sets.join(", ")} WHERE Z_PK = ?`,
        params as never,
      );
    },
    softDelete(table, pk) {
      const now = coreDataNow();
      db.run(
        `UPDATE ${table}
         SET ZDELETEDFLAG = 1,
             ZLASTMODIFICATION = ?,
             ZLOCALMODDATE = ?,
             Z_OPT = Z_OPT + 1
         WHERE Z_PK = ?`,
        [now, now, pk] as never,
      );
    },
  };
}
