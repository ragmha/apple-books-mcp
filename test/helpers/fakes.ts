import type { Database } from "bun:sqlite";
import type {
  BackupInfo,
  BooksAppPort,
  LibraryStore,
} from "../../src/db/library-mutation.ts";

type Call = string;

/**
 * In-memory test adapter for LibraryStore. Hands out the seeded DB for both
 * reads and writes (one DB per test). Records snapshot / verifySnapshot calls
 * in `calls` so tests can assert ordering against FakeBooksAppPort.
 *
 * `verifySnapshot` returns the value of `verifyResult` (default true), so
 * tests that want to simulate a corrupt backup can flip it.
 *
 * `backups` is the list returned from `listBackups`. `restoreFromBackup`
 * records the call and (unless `restoreError` is set) increments
 * `restoresPerformed`.
 */
export class FakeLibraryStore implements LibraryStore {
  verifyResult = true;
  /** When set, snapshot() throws this error instead of recording a snapshot. */
  snapshotError: Error | null = null;
  /** When set, restoreFromBackup() throws this error instead of swapping. */
  restoreError: Error | null = null;
  snapshotsTaken = 0;
  restoresPerformed = 0;
  backups: BackupInfo[] = [];
  readonly calls: Call[];

  constructor(
    private db: Database,
    callLog?: Call[],
  ) {
    this.calls = callLog ?? [];
  }

  openWritable(): Database {
    return this.db;
  }

  snapshot(): string {
    if (this.snapshotError) throw this.snapshotError;
    this.snapshotsTaken += 1;
    this.calls.push("snapshot");
    return `fake-snapshot-${this.snapshotsTaken}`;
  }

  verifySnapshot(handle: string): boolean {
    this.calls.push(`verify:${handle}`);
    return this.verifyResult;
  }

  listBackups(): BackupInfo[] {
    return this.backups;
  }

  restoreFromBackup(handle: string): void {
    this.calls.push(`restoreFromBackup:${handle}`);
    if (this.restoreError) throw this.restoreError;
    this.restoresPerformed += 1;
  }
}

/**
 * In-memory test adapter for BooksAppPort. Records every call so tests can
 * assert the exact sequence (e.g. `quit` happened before `mutate`'s callback
 * ran, `launch` did not happen on rollback). The `*Error` knobs let tests
 * inject failures into specific lifecycle steps.
 */
export class FakeBooksAppPort implements BooksAppPort {
  running: boolean;
  quitError: Error | null = null;
  launchError: Error | null = null;
  readonly calls: Call[];

  constructor(opts: { running?: boolean; callLog?: Call[] } = {}) {
    this.running = opts.running ?? false;
    this.calls = opts.callLog ?? [];
  }

  async isRunning(): Promise<boolean> {
    this.calls.push("isRunning");
    return this.running;
  }

  async quit(): Promise<void> {
    this.calls.push("quit");
    if (this.quitError) throw this.quitError;
    this.running = false;
  }

  async launch(): Promise<void> {
    this.calls.push("launch");
    if (this.launchError) throw this.launchError;
    this.running = true;
  }
}
