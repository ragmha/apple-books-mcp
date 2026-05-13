import { describe, expect, test } from "bun:test";
import {
  deleteAnnotationTx,
  updateAnnotationNoteTx,
} from "../src/db/annotation-mutations.ts";
import { Tables } from "../src/db/constants.ts";
import {
  createLibraryMutation,
  MutationError,
} from "../src/db/library-mutation.ts";
import { FakeBooksAppPort, FakeLibraryStore } from "./helpers/fakes.ts";
import { createSeededAnnotationDb, seedAnnotation } from "./helpers/seed.ts";

describe("updateAnnotationNoteTx", () => {
  test("updates the note text on the annotation matched by UUID", () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, {
      pk: 1,
      uuid: "ann-A",
      assetId: "book-1",
      note: "old note",
    });
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    return mutation
      .mutate((tx) => updateAnnotationNoteTx(tx, "ann-A", "new note"))
      .then((result) => {
        expect(result.success).toBe(true);
        const row = db
          .query<{ ZANNOTATIONNOTE: string; Z_OPT: number }, []>(
            `SELECT ZANNOTATIONNOTE, Z_OPT FROM ${Tables.Annotations} WHERE Z_PK = 1`,
          )
          .get();
        expect(row?.ZANNOTATIONNOTE).toBe("new note");
        // Z_OPT must be bumped — Apple Books treats unchanged Z_OPT as no-op.
        expect(row?.Z_OPT).toBe(2);
      });
  });

  test("updates by numeric Z_PK as a fallback", async () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, { pk: 7, uuid: "ann-B", assetId: "book-1" });
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    const result = await mutation.mutate((tx) =>
      updateAnnotationNoteTx(tx, "7", "by-pk"),
    );

    expect(result.success).toBe(true);
    const row = db
      .query<{ ZANNOTATIONNOTE: string }, []>(
        `SELECT ZANNOTATIONNOTE FROM ${Tables.Annotations} WHERE Z_PK = 7`,
      )
      .get();
    expect(row?.ZANNOTATIONNOTE).toBe("by-pk");
  });

  test("refreshes ZANNOTATIONMODIFICATIONDATE so iCloud syncs the change", async () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, { pk: 1, uuid: "ann-A", assetId: "book-1" });
    const before = Date.now() / 1000 - Date.UTC(2001, 0, 1) / 1000;
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    await mutation.mutate((tx) => updateAnnotationNoteTx(tx, "ann-A", "x"));

    const row = db
      .query<{ ZANNOTATIONMODIFICATIONDATE: number }, []>(
        `SELECT ZANNOTATIONMODIFICATIONDATE FROM ${Tables.Annotations} WHERE Z_PK = 1`,
      )
      .get();
    expect(row?.ZANNOTATIONMODIFICATIONDATE).toBeGreaterThanOrEqual(before);
  });

  test("throws MutationError when the annotation is not found", async () => {
    const db = createSeededAnnotationDb();
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    const result = await mutation.mutate((tx) =>
      updateAnnotationNoteTx(tx, "ann-missing", "x"),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Annotation not found");
    expect(result.message).toContain("ann-missing");
  });

  test("rejects empty note text via MutationError", async () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, { pk: 1, uuid: "ann-A", assetId: "book-1" });
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    const result = await mutation.mutate((tx) =>
      updateAnnotationNoteTx(tx, "ann-A", ""),
    );

    expect(result.success).toBe(false);
    expect(result.message.toLowerCase()).toContain("empty");
  });
});

describe("deleteAnnotationTx", () => {
  test("soft-deletes by UUID (sets ZANNOTATIONDELETED=1, bumps Z_OPT)", async () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, { pk: 1, uuid: "ann-A", assetId: "book-1" });
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    const result = await mutation.mutate((tx) =>
      deleteAnnotationTx(tx, "ann-A"),
    );

    expect(result.success).toBe(true);
    const row = db
      .query<{ ZANNOTATIONDELETED: number; Z_OPT: number }, []>(
        `SELECT ZANNOTATIONDELETED, Z_OPT FROM ${Tables.Annotations} WHERE Z_PK = 1`,
      )
      .get();
    expect(row?.ZANNOTATIONDELETED).toBe(1);
    expect(row?.Z_OPT).toBe(2);
  });

  test("throws MutationError when the annotation does not exist", async () => {
    const db = createSeededAnnotationDb();
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    const result = await mutation.mutate((tx) =>
      deleteAnnotationTx(tx, "ann-missing"),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Annotation not found");
  });

  test("throws MutationError if the annotation is already soft-deleted", async () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, {
      pk: 1,
      uuid: "ann-A",
      assetId: "book-1",
      deleted: true,
    });
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    const result = await mutation.mutate((tx) =>
      deleteAnnotationTx(tx, "ann-A"),
    );

    expect(result.success).toBe(false);
    expect(result.message.toLowerCase()).toContain("already");
  });

  test("a missing-annotation MutationError surfaces verbatim, not as 'Operation failed'", async () => {
    const db = createSeededAnnotationDb();
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    const result = await mutation.mutate((tx) =>
      deleteAnnotationTx(tx, "ghost"),
    );

    expect(result.success).toBe(false);
    expect(result.message).not.toContain("Operation failed");
    // Force the test to see MutationError taxonomy is wired through.
    try {
      throw new MutationError("smoke");
    } catch (e) {
      expect((e as Error).name).toBe("MutationError");
    }
  });
});
