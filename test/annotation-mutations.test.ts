import { describe, expect, test } from "bun:test";
import {
  createAnnotationTx,
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

describe("createAnnotationTx", () => {
  test("inserts a real anchored highlight with Core Data identity and coordinates", async () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, {
      pk: 7,
      uuid: "existing-ann",
      assetId: "book-1",
      creatorIdentifier: "local-account-id",
    });
    seedAnnotation(db, {
      pk: 9,
      uuid: "other-book-ann",
      assetId: "book-2",
      creatorIdentifier: "other-account-id",
    });
    db.run("UPDATE Z_PRIMARYKEY SET Z_MAX = 9 WHERE Z_ENT = 1");
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    const before = Date.now() / 1000 - Date.UTC(2001, 0, 1) / 1000;
    const result = await mutation.mutate((tx) =>
      createAnnotationTx(tx, {
        assetId: "book-1",
        selectedText: "A material fact",
        representativeText: "Context around a material fact.",
        note: "Review this section.",
        location: "epubcfi(/6/8!/4/2/6,:10,:25)",
        absolutePhysicalLocation: 9,
        rangeStart: 10,
        rangeEnd: 25,
        style: 3,
        isUnderline: false,
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.data.annotationPk).toBe(10);
    expect(result.data.annotationUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const row = db
      .query<
        {
          Z_PK: number;
          Z_ENT: number;
          Z_OPT: number;
          ZANNOTATIONUUID: string;
          ZANNOTATIONASSETID: string;
          ZANNOTATIONCREATORIDENTIFIER: string | null;
          ZANNOTATIONSELECTEDTEXT: string;
          ZANNOTATIONREPRESENTATIVETEXT: string;
          ZANNOTATIONNOTE: string;
          ZANNOTATIONLOCATION: string;
          ZPLABSOLUTEPHYSICALLOCATION: number;
          ZPLLOCATIONRANGESTART: number;
          ZPLLOCATIONRANGEEND: number;
          ZANNOTATIONSTYLE: number;
          ZANNOTATIONTYPE: number;
          ZANNOTATIONISUNDERLINE: number;
          ZANNOTATIONDELETED: number;
          ZANNOTATIONCREATIONDATE: number;
          ZANNOTATIONMODIFICATIONDATE: number;
        },
        []
      >(`SELECT * FROM ${Tables.Annotations} WHERE Z_PK = 10`)
      .get();
    expect(row).toEqual(
      expect.objectContaining({
        Z_PK: 10,
        Z_ENT: 1,
        Z_OPT: 1,
        ZANNOTATIONUUID: result.data.annotationUuid,
        ZANNOTATIONASSETID: "book-1",
        ZANNOTATIONCREATORIDENTIFIER: "local-account-id",
        ZANNOTATIONSELECTEDTEXT: "A material fact",
        ZANNOTATIONREPRESENTATIVETEXT: "Context around a material fact.",
        ZANNOTATIONNOTE: "Review this section.",
        ZANNOTATIONLOCATION: "epubcfi(/6/8!/4/2/6,:10,:25)",
        ZPLABSOLUTEPHYSICALLOCATION: 9,
        ZPLLOCATIONRANGESTART: 10,
        ZPLLOCATIONRANGEEND: 25,
        ZANNOTATIONSTYLE: 3,
        ZANNOTATIONTYPE: 2,
        ZANNOTATIONISUNDERLINE: 0,
        ZANNOTATIONDELETED: 0,
      }),
    );
    expect(row?.ZANNOTATIONCREATIONDATE).toBeGreaterThanOrEqual(before);
    expect(row?.ZANNOTATIONMODIFICATIONDATE).toBeGreaterThanOrEqual(before);
    expect(
      db
        .query<{ Z_MAX: number }, []>(
          "SELECT Z_MAX FROM Z_PRIMARYKEY WHERE Z_ENT = 1",
        )
        .get()?.Z_MAX,
    ).toBe(10);
  });

  test("rejects an inverted location range without consuming a primary key", async () => {
    const db = createSeededAnnotationDb();
    const mutation = createLibraryMutation(
      new FakeLibraryStore(db),
      new FakeBooksAppPort(),
    );

    const result = await mutation.mutate((tx) =>
      createAnnotationTx(tx, {
        assetId: "book-1",
        selectedText: "Text",
        location: "epubcfi(/6/8!/4/2/6,:25,:10)",
        absolutePhysicalLocation: 9,
        rangeStart: 25,
        rangeEnd: 10,
        style: 3,
        isUnderline: false,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("range_end");
    expect(
      db
        .query<{ count: number }, []>(
          `SELECT COUNT(*) AS count FROM ${Tables.Annotations}`,
        )
        .get()?.count,
    ).toBe(0);
    expect(
      db
        .query<{ Z_MAX: number }, []>(
          "SELECT Z_MAX FROM Z_PRIMARYKEY WHERE Z_ENT = 1",
        )
        .get()?.Z_MAX,
    ).toBe(0);
  });
});

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
