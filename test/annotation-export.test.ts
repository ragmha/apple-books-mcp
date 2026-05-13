import { describe, expect, test } from "bun:test";
import { exportAnnotationsMarkdown } from "../src/db/annotation-export.ts";
import { createSeededAnnotationDb, seedAnnotation } from "./helpers/seed.ts";

describe("exportAnnotationsMarkdown", () => {
  test("returns the markdown header with the asset id when no annotations exist", () => {
    const db = createSeededAnnotationDb();

    const md = exportAnnotationsMarkdown(db, "book-empty");

    expect(md).toContain("# Annotations for book-empty");
    expect(md).toContain("_No annotations._");
  });

  test("emits one block per annotation with selectedText quoted and note formatted", () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, {
      pk: 1,
      uuid: "ann-A",
      assetId: "book-1",
      selectedText: "The unexamined life is not worth living.",
      note: "A famous Socratic claim.",
    });
    seedAnnotation(db, {
      pk: 2,
      uuid: "ann-B",
      assetId: "book-1",
      selectedText: "Wisdom begins in wonder.",
      note: "",
    });

    const md = exportAnnotationsMarkdown(db, "book-1");

    expect(md).toContain("> The unexamined life is not worth living.");
    expect(md).toContain("**Note:** A famous Socratic claim.");
    expect(md).toContain("> Wisdom begins in wonder.");
    // Annotation B has no note — must NOT print an empty Note: block.
    expect(md).not.toMatch(/\*\*Note:\*\*\s*$/m);
  });

  test("filters by assetId when provided", () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, {
      pk: 1,
      uuid: "ann-A",
      assetId: "book-1",
      selectedText: "for book one",
    });
    seedAnnotation(db, {
      pk: 2,
      uuid: "ann-B",
      assetId: "book-2",
      selectedText: "for book two",
    });

    const md = exportAnnotationsMarkdown(db, "book-1");

    expect(md).toContain("for book one");
    expect(md).not.toContain("for book two");
  });

  test("excludes soft-deleted annotations", () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, {
      pk: 1,
      uuid: "ann-live",
      assetId: "book-1",
      selectedText: "still here",
    });
    seedAnnotation(db, {
      pk: 2,
      uuid: "ann-dead",
      assetId: "book-1",
      selectedText: "should not appear",
      deleted: true,
    });

    const md = exportAnnotationsMarkdown(db, "book-1");

    expect(md).toContain("still here");
    expect(md).not.toContain("should not appear");
  });

  test("escapes markdown-active characters in selected text and notes (no injection)", () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, {
      pk: 1,
      uuid: "ann-A",
      assetId: "book-1",
      selectedText: "Use [link](http://evil) and **bold** here",
      note: "And # not a heading",
    });

    const md = exportAnnotationsMarkdown(db, "book-1");

    // Square brackets and asterisks must be escaped so the user sees the
    // raw text rather than rendered markdown / a hyperlink.
    expect(md).toContain("\\[link\\]");
    expect(md).toContain("\\*\\*bold\\*\\*");
    // Leading # in a note must be escaped so it doesn't render as a heading.
    expect(md).toContain("\\# not a heading");
  });

  test("returns a top-level export when no assetId is given (all books, grouped)", () => {
    const db = createSeededAnnotationDb();
    seedAnnotation(db, {
      pk: 1,
      uuid: "ann-A",
      assetId: "book-1",
      selectedText: "from book one",
    });
    seedAnnotation(db, {
      pk: 2,
      uuid: "ann-B",
      assetId: "book-2",
      selectedText: "from book two",
    });

    const md = exportAnnotationsMarkdown(db);

    // Without an assetId we get every book grouped under its own header.
    expect(md).toContain("# Annotations export");
    expect(md).toContain("## book-1");
    expect(md).toContain("## book-2");
    expect(md).toContain("from book one");
    expect(md).toContain("from book two");
  });
});
