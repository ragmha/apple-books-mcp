import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { exportAnnotationsMarkdown } from "../src/db/annotation-export.ts";
import { createAnnotationQueries } from "../src/db/annotations.ts";
import { createBookQueries } from "../src/db/books.ts";
import { createCollectionQueries } from "../src/db/collections.ts";
import { Tables } from "../src/db/constants.ts";
import {
  createSeededAnnotationDb,
  createSeededDb,
  seedAnnotation,
  seedBook,
  seedCollection,
} from "./helpers/seed.ts";

const COUNT = 137;
const databases: Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function fixture() {
  const lib = createSeededDb();
  const ann = createSeededAnnotationDb();
  databases.push(lib, ann);
  for (let pk = COUNT; pk >= 1; pk--) {
    seedBook(lib, { pk, assetId: `book-${pk}`, title: "Matching book" });
    seedCollection(lib, {
      pk,
      uuid: `collection-${pk}`,
      title: "Matching collection",
    });
    seedAnnotation(ann, {
      pk,
      uuid: `annotation-${pk}`,
      assetId: "book-1",
      selectedText: `Matching quote ${pk}`,
      note: `Matching note ${pk}`,
      style: 1,
    });
    lib.run(
      `INSERT INTO ${Tables.CollectionMembers} (Z_PK, ZASSET, ZCOLLECTION) VALUES (?, ?, 1)`,
      [pk, pk],
    );
  }
  lib.run(`UPDATE ${Tables.Books} SET ZSORTTITLE = 'tied'`);
  lib.run(`UPDATE ${Tables.Collections} SET ZSORTKEY = 1`);
  lib.run(`CREATE INDEX book_sort ON ${Tables.Books} (ZSORTTITLE, Z_PK DESC)`);
  lib.run(
    `CREATE INDEX collection_sort ON ${Tables.Collections} (ZSORTKEY, Z_PK DESC)`,
  );
  ann.run(
    `CREATE INDEX annotation_sort ON ${Tables.Annotations} (ZANNOTATIONMODIFICATIONDATE DESC, Z_PK ASC)`,
  );

  seedBook(lib, { pk: 900, assetId: "metadata", title: "Metadata" });
  lib.run(`UPDATE ${Tables.Books} SET ZCONTENTTYPE = NULL WHERE Z_PK = 900`);
  seedCollection(lib, {
    pk: 900,
    uuid: "placeholder",
    title: "Sync Placeholder",
  });
  seedCollection(lib, { pk: 901, uuid: "deleted", title: "Matching deleted" });
  lib.run(`UPDATE ${Tables.Collections} SET ZDELETEDFLAG = 1 WHERE Z_PK = 901`);
  seedAnnotation(ann, {
    pk: 900,
    uuid: "deleted",
    assetId: "book-1",
    selectedText: "Matching deleted",
    note: "Matching deleted",
    deleted: true,
  });
  ann.run(
    `UPDATE ${Tables.Annotations} SET ZANNOTATIONDELETED = NULL WHERE Z_PK = 137`,
  );

  const books = createBookQueries(() => lib);
  const collections = createCollectionQueries(() => lib);
  const annotations = createAnnotationQueries(() => ann);
  return {
    lib,
    ann,
    books,
    collections,
    annotations,
    arrays: {
      listCollections: collections.listCollections,
      getCollectionBooks: (limit?: number, offset?: number) =>
        collections.getCollectionBooks("collection-1", limit, offset),
      searchBooks: (limit?: number, offset?: number) =>
        books.searchBooks("Matching", limit, offset),
      searchHighlightedText: (limit?: number, offset?: number) =>
        annotations.searchHighlightedText("Matching", limit, offset),
      searchNotes: (limit?: number, offset?: number) =>
        annotations.searchNotes("Matching", limit, offset),
      fullTextSearch: (limit?: number, offset?: number) =>
        annotations.fullTextSearch("Matching", limit, offset),
    },
  };
}

const endpoints = [
  { name: "listCollections", descending: false },
  { name: "getCollectionBooks", descending: false },
  { name: "searchBooks", descending: false },
  { name: "searchHighlightedText", descending: true },
  { name: "searchNotes", descending: true },
  { name: "fullTextSearch", descending: true },
] satisfies {
  name: keyof ReturnType<typeof fixture>["arrays"];
  descending: boolean;
}[];

function identities(rows: { id: number }[]): number[] {
  return rows.map((row) => row.id);
}

function expectedIds(descending = false): number[] {
  const ids = Array.from({ length: COUNT }, (_, index) => index + 1);
  return descending ? ids.reverse() : ids;
}

describe("paginated domain arrays", () => {
  test.each(
    endpoints,
  )("$name preserves arrays and traverses every row with stable ties", ({
    name,
    descending,
  }) => {
    const read = fixture().arrays[name];
    const expected = expectedIds(descending);
    const first = read();
    expect(Array.isArray(first)).toBe(true);
    expect(first).toHaveLength(50);
    expect(identities(first)).toEqual(expected.slice(0, 50));
    expect(identities(read(1000))).toEqual(expected.slice(0, 100));
    expect(identities(read(20, 120))).toEqual(expected.slice(120));
    expect([...identities(read(100)), ...identities(read(100, 100))]).toEqual(
      expected,
    );
    expect(read(50, COUNT)).toEqual([]);
    expect(read(1, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });

  test.each(endpoints)("$name explicitly rejects invalid direct pagination", ({
    name,
  }) => {
    const read = fixture().arrays[name];
    for (const limit of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => read(limit)).toThrow(/limit/);
    }
    for (const offset of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => read(10, offset)).toThrow(/offset/);
    }
    expect(read(Number.MAX_SAFE_INTEGER)).toHaveLength(100);
  });
});

describe("existing page and full-read contracts", () => {
  test("listBooks defaults to 50 and counts precisely the rows it paginates", () => {
    const { books } = fixture();
    const first = books.listBooks();
    expect(first).toMatchObject({ total: COUNT, limit: 50, offset: 0 });
    expect(identities(first.books)).toEqual(expectedIds().slice(0, 50));
    const second = books.listBooks(1000, 100);
    expect(second).toMatchObject({ total: COUNT, limit: 100, offset: 100 });
    expect(identities(second.books)).toEqual(expectedIds().slice(100));
    expect(books.listBooks(50, COUNT).books).toEqual([]);
  });

  test("annotation pages keep counts aligned with active rows and stable date ties", () => {
    const { annotations, ann } = fixture();
    seedAnnotation(ann, {
      pk: 901,
      uuid: "yellow",
      assetId: "another-book",
      style: 3,
    });
    const all = annotations.listAllAnnotations(100, 100);
    expect(all).toMatchObject({ total: COUNT + 1, limit: 100, offset: 100 });
    expect(identities(all.annotations)).toEqual(
      [901, ...expectedIds(true)].slice(100),
    );
    const green = annotations.getHighlightsByColor("green", 1000, 100);
    expect(green).toMatchObject({ total: COUNT, limit: 100, offset: 100 });
    expect(identities(green.annotations)).toEqual(expectedIds(true).slice(100));
    expect(
      annotations
        .getHighlightsByColor("yellow")
        .annotations.map((row) => row.id),
    ).toEqual([901]);
  });

  test("existing page methods apply the same direct-caller integer policy", () => {
    const { books, annotations } = fixture();
    const pages = [
      books.listBooks,
      annotations.listAllAnnotations,
      (limit?: number, offset?: number) =>
        annotations.getHighlightsByColor("green", limit, offset),
    ];
    for (const read of pages) {
      for (const limit of [
        0,
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        expect(() => read(limit)).toThrow(/limit/);
      }
      for (const offset of [
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        expect(() => read(10, offset)).toThrow(/offset/);
      }
      expect(read()).toMatchObject({ limit: 50, offset: 0 });
    }
  });

  test("full library reads, per-book annotations and exports remain uncapped", () => {
    const { books, annotations, ann } = fixture();
    expect(identities(books.listAllBooks())).toEqual(expectedIds());
    expect(identities(annotations.getAnnotationsByBookId("book-1"))).toEqual(
      expectedIds(),
    );
    expect(annotations.recentAnnotations()).toHaveLength(10);
    expect(annotations.recentAnnotations(120)).toHaveLength(120);
    expect(identities(annotations.recentAnnotations())).toEqual(
      expectedIds(true).slice(0, 10),
    );
    for (const markdown of [
      exportAnnotationsMarkdown(ann),
      exportAnnotationsMarkdown(ann, "book-1"),
    ]) {
      expect(markdown.match(/^> Matching quote \d+$/gm)).toHaveLength(COUNT);
      expect(markdown).toContain("> Matching quote 137");
      expect(markdown).not.toContain("Matching deleted");
    }
  });
});
