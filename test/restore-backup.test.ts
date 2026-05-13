import { describe, expect, test } from "bun:test";
import { createLibraryMutation } from "../src/db/library-mutation.ts";
import { FakeBooksAppPort, FakeLibraryStore } from "./helpers/fakes.ts";
import { createSeededDb } from "./helpers/seed.ts";

describe("LibraryMutation.listBackups", () => {
  test("delegates to the store and returns the list", () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    store.backups = [
      {
        handle: "fake-snapshot-2",
        createdAt: "2026-01-02T00:00:00.000Z",
        sizeBytes: 200,
      },
      {
        handle: "fake-snapshot-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        sizeBytes: 100,
      },
    ];
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    expect(mutation.listBackups()).toEqual(store.backups);
  });

  test("returns an empty array when no backups exist", () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    expect(mutation.listBackups()).toEqual([]);
  });
});

describe("LibraryMutation.restore", () => {
  test("verifies backup, quits Books, takes safety snapshot, swaps file, launches Books", async () => {
    const db = createSeededDb();
    const callLog: string[] = [];
    const store = new FakeLibraryStore(db, callLog);
    store.backups = [
      {
        handle: "backup-A",
        createdAt: "2026-01-01T00:00:00.000Z",
        sizeBytes: 100,
      },
    ];
    const books = new FakeBooksAppPort({ running: true, callLog });
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.restore("backup-A");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.restoredFrom).toBe("backup-A");
      expect(result.safetyBackupPath).toBe("fake-snapshot-1");
    }

    // Lifecycle: verify before any side effect, quit before file swap,
    // safety snapshot before swap, swap, then launch.
    expect(callLog).toEqual([
      "verify:backup-A",
      "isRunning",
      "quit",
      "snapshot",
      "restoreFromBackup:backup-A",
      "launch",
    ]);
  });

  test("does NOT touch Books or the filesystem when the chosen backup fails verification", async () => {
    const db = createSeededDb();
    const callLog: string[] = [];
    const store = new FakeLibraryStore(db, callLog);
    store.verifyResult = false;
    const books = new FakeBooksAppPort({ running: true, callLog });
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.restore("backup-corrupt");

    expect(result.success).toBe(false);
    expect(result.message).toContain("integrity check");
    // Only the verify call should have happened; nothing destructive.
    expect(callLog).toEqual(["verify:backup-corrupt"]);
    expect(store.restoresPerformed).toBe(0);
  });

  test("returns a sanitised failure if quitting Books fails (no swap, no launch)", async () => {
    const db = createSeededDb();
    const callLog: string[] = [];
    const store = new FakeLibraryStore(db, callLog);
    const books = new FakeBooksAppPort({ running: true, callLog });
    books.quitError = new Error("osascript timed out with PII: 'Secret Title'");
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.restore("backup-A");

    expect(result.success).toBe(false);
    expect(result.message).not.toContain("Secret Title");
    expect(result.message).toContain("quit Books");
    expect(callLog).toEqual(["verify:backup-A", "isRunning", "quit"]);
    expect(store.restoresPerformed).toBe(0);
  });

  test("returns failure if the pre-restore safety snapshot fails (no swap)", async () => {
    const db = createSeededDb();
    const callLog: string[] = [];
    const store = new FakeLibraryStore(db, callLog);
    store.snapshotError = new Error("disk full");
    const books = new FakeBooksAppPort({ running: false, callLog });
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.restore("backup-A");

    expect(result.success).toBe(false);
    expect(result.message).toContain("safety snapshot");
    expect(store.restoresPerformed).toBe(0);
    // No launch — we never even started the swap.
    expect(callLog).not.toContain("launch");
  });

  test("returns failure with the safety snapshot path if the file swap itself fails", async () => {
    const db = createSeededDb();
    const callLog: string[] = [];
    const store = new FakeLibraryStore(db, callLog);
    store.restoreError = new Error(
      "EACCES: permission denied — /Users/x/notes.txt",
    );
    const books = new FakeBooksAppPort({ running: false, callLog });
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.restore("backup-A");

    expect(result.success).toBe(false);
    // Sanitised — no PII paths.
    expect(result.message).not.toContain("/Users/x/notes.txt");
    // But MUST tell the user where the safety snapshot went.
    expect(result.message).toContain("fake-snapshot-1");
    expect(callLog).not.toContain("launch");
  });

  test("still reports success if launch fails after a successful swap (data is restored)", async () => {
    const db = createSeededDb();
    const callLog: string[] = [];
    const store = new FakeLibraryStore(db, callLog);
    const books = new FakeBooksAppPort({ running: false, callLog });
    books.launchError = new Error("open: Books not found");
    const mutation = createLibraryMutation(store, books);

    const result = await mutation.restore("backup-A");

    expect(result.success).toBe(true);
    expect(store.restoresPerformed).toBe(1);
  });
});
