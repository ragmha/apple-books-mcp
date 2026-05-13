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

  /**
   * Restore the live Library from a previously-taken backup. Production
   * overwrites the live `.sqlite` file with the backup's bytes. Caller must
   * ensure Books.app is not running and that integrity has been verified.
   */
  restoreFromBackup(handle: string): void;
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
   * pre-restore safety snapshot → swap the file → relaunch Books.
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
  return {
    listBackups() {
      return store.listBackups();
    },

    async restore(handle) {
      // 1. Verify the chosen backup BEFORE doing anything destructive.
      //    A corrupt backup is unrecoverable, so abort early.
      if (!store.verifySnapshot(handle)) {
        return {
          success: false,
          message: `Backup ${handle} failed integrity check; aborted before any change.`,
        };
      }

      // 2. Quit Books so the file copy is safe (Books holds the SQLite
      //    file open in WAL mode otherwise).
      try {
        if (await booksApp.isRunning()) {
          await booksApp.quit();
        }
      } catch (error) {
        console.error("LibraryMutation.restore: quit failed:", error);
        return {
          success: false,
          message: "Operation failed: could not quit Books.app.",
        };
      }

      // 3. Snapshot the CURRENT state before overwriting it. If the user
      //    chose the wrong backup, this safety snapshot is their escape hatch.
      let safetyBackupPath: string;
      try {
        safetyBackupPath = store.snapshot();
      } catch (error) {
        console.error(
          "LibraryMutation.restore: pre-restore safety snapshot failed:",
          error,
        );
        return {
          success: false,
          message:
            "Operation failed: could not take pre-restore safety snapshot of current Library.",
        };
      }

      // 4. Overwrite the live Library with the chosen backup's bytes.
      try {
        store.restoreFromBackup(handle);
      } catch (error) {
        console.error("LibraryMutation.restore: file swap failed:", error);
        return {
          success: false,
          message: `Operation failed during file swap. Pre-restore safety snapshot saved at ${safetyBackupPath}.`,
          safetyBackupPath,
        };
      }

      // 5. Relaunch Books. A launch failure here is non-fatal — the data
      //    is restored on disk; the user can reopen Books manually.
      try {
        await booksApp.launch();
      } catch (error) {
        console.error(
          "LibraryMutation.restore: launch failed after successful restore:",
          error,
        );
      }

      return {
        success: true,
        restoredFrom: handle,
        safetyBackupPath,
        message: `Restored Library from ${handle}. Pre-restore safety snapshot saved at ${safetyBackupPath}.`,
      };
    },

    async mutate(fn, options) {
      // Outer try/catch: any failure during setup (snapshot, verify, quit,
      // openWritable, BEGIN) must surface as a structured MutationResult,
      // never reject the promise.
      let backupPath: string;
      try {
        backupPath = store.snapshot();
      } catch (error) {
        console.error("LibraryMutation snapshot failed:", error);
        return {
          success: false,
          message: "Operation failed: could not snapshot the Library.",
        };
      }

      if (!store.verifySnapshot(backupPath)) {
        return {
          success: false,
          message: `Backup integrity check failed; aborted before any change. Backup: ${backupPath}`,
          backupPath,
        };
      }

      try {
        if (await booksApp.isRunning()) {
          await booksApp.quit();
        }
      } catch (error) {
        console.error("LibraryMutation quit failed:", error);
        return {
          success: false,
          message: `Operation failed: could not quit Books.app. Backup: ${backupPath}`,
          backupPath,
        };
      }

      const db = store.openWritable();
      // The transaction is only `active` between BEGIN and COMMIT/ROLLBACK.
      // Track it explicitly so the cleanup path never tries to ROLLBACK after
      // a successful COMMIT (which throws "no transaction is active") and so
      // a launch failure post-COMMIT does not undo a persisted change.
      let transactionActive = false;
      let committed = false;
      try {
        db.run("BEGIN IMMEDIATE");
        transactionActive = true;
        const tx = makeTx(db);
        const data = await fn(tx);
        db.run("COMMIT");
        transactionActive = false;
        committed = true;

        if (!options?.skipRestart) {
          try {
            await booksApp.launch();
          } catch (error) {
            // Launch failed AFTER the data committed. The mutation succeeded;
            // the user just has to reopen Books manually. Log and continue.
            console.error(
              "LibraryMutation: launch failed after successful COMMIT:",
              error,
            );
          }
        }

        return {
          success: true,
          data,
          message: "Mutation applied successfully.",
          backupPath,
        };
      } catch (error) {
        if (transactionActive) {
          // ROLLBACK can itself throw (e.g. SQLite reports "no active
          // transaction" if COMMIT half-succeeded). Wrap it so the cleanup
          // failure does not mask the original error from the caller.
          try {
            db.run("ROLLBACK");
          } catch (rollbackError) {
            console.error(
              "LibraryMutation: ROLLBACK failed during cleanup:",
              rollbackError,
            );
          }
          transactionActive = false;
        }

        if (committed) {
          // Defensive: if we get here it means the post-COMMIT block threw
          // somehow despite the inner try/catch around launch. The data is
          // on disk, so honour that.
          return {
            success: true,
            data: undefined as never,
            message:
              "Mutation applied successfully (with post-commit warning).",
            backupPath,
          };
        }

        if (error instanceof MutationError) {
          return { success: false, message: error.message, backupPath };
        }
        // System error: log full detail to stderr, but never surface raw
        // error text to callers — it may contain user PII (titles, notes)
        // from SQLite constraint messages.
        console.error("LibraryMutation system error:", error);
        return {
          success: false,
          message: `Operation failed. Backup: ${backupPath}`,
          backupPath,
        };
      }
    },
  };
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
