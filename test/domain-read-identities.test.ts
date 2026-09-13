import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
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

const databases: Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function fixture(naturalId = "natural") {
  const lib = createSeededDb();
  const ann = createSeededAnnotationDb();
  databases.push(lib, ann);
  for (const [pk, id] of [
    [14, "unrelated"],
    [99, naturalId],
  ] as const) {
    seedBook(lib, { pk, assetId: id, title: `Book ${pk}` });
    seedCollection(lib, { pk, uuid: id, title: `Collection ${pk}` });
    seedAnnotation(ann, { pk, uuid: id, assetId: id });
    lib.run(
      `INSERT INTO ${Tables.CollectionMembers} (Z_PK, ZASSET, ZCOLLECTION) VALUES (?, ?, ?)`,
      [pk, pk, pk],
    );
  }
  return {
    lib,
    ann,
    ...createBookQueries(() => lib),
    ...createCollectionQueries(() => lib),
    ...createAnnotationQueries(() => ann),
  };
}

describe("domain read identity resolution", () => {
  test.each([
    "14suffix",
    "14.0",
    "14e0",
    " 14",
    "14 ",
    "+14",
    "0xE",
  ])("does not partially parse %s as a primary key", (id) => {
    const queries = fixture();
    expect(queries.getBookById(id)).toBeNull();
    expect(queries.getCollectionById(id)).toBeNull();
    expect(queries.getCollectionBooks(id)).toEqual([]);
    expect(queries.getAnnotationById(id)).toBeNull();
  });

  test.each([
    "14",
    "0014",
    "14suffix",
    "0",
    "-14",
    "9007199254740993",
  ])("prefers the exact natural key %s even when it resembles a PK", (id) => {
    const queries = fixture(id);
    expect(queries.getBookById(id)?.id).toBe(99);
    expect(queries.getBookById(id)?.assetId).toBe(id);
    expect(queries.getCollectionById(id)?.id).toBe(99);
    expect(queries.getCollectionBooks(id).map((book) => book.id)).toEqual([99]);
    expect(queries.getAnnotationById(id)?.id).toBe(99);
  });

  test.each([
    "14",
    "0014",
  ])("allows positive whole-decimal PK fallback %s after a missing natural key", (id) => {
    const queries = fixture();
    expect(queries.getBookById(id)?.assetId).toBe("unrelated");
    expect(queries.getCollectionById(id)?.collectionId).toBe("unrelated");
    expect(queries.getCollectionBooks(id).map((book) => book.id)).toEqual([14]);
    expect(queries.getAnnotationById(id)?.uuid).toBe("unrelated");
  });

  test.each([
    0, -14, 9007199254740992,
  ])("does not use an unsupported internal PK %s, even if that row exists", (pk) => {
    const queries = fixture();
    const id = String(pk);
    seedBook(queries.lib, { pk, assetId: "unsupported", title: "Unsupported" });
    seedCollection(queries.lib, {
      pk,
      uuid: "unsupported",
      title: "Unsupported",
    });
    seedAnnotation(queries.ann, {
      pk,
      uuid: "unsupported",
      assetId: "unsupported",
    });
    queries.lib.run(
      `INSERT INTO ${Tables.CollectionMembers} (Z_PK, ZASSET, ZCOLLECTION) VALUES (?, ?, ?)`,
      [pk, pk, pk],
    );

    expect(queries.getBookById(id)).toBeNull();
    expect(queries.getCollectionById(id)).toBeNull();
    expect(queries.getCollectionBooks(id)).toEqual([]);
    expect(queries.getAnnotationById(id)).toBeNull();
    expect(queries.getBookById("unsupported")?.assetId).toBe("unsupported");
  });

  test("accepts the largest safe positive PK", () => {
    const queries = fixture();
    const pk = Number.MAX_SAFE_INTEGER;
    seedBook(queries.lib, { pk, assetId: "largest", title: "Largest" });
    seedCollection(queries.lib, { pk, uuid: "largest", title: "Largest" });
    seedAnnotation(queries.ann, { pk, uuid: "largest", assetId: "largest" });

    expect(queries.getBookById(String(pk))?.id).toBe(pk);
    expect(queries.getCollectionById(String(pk))?.id).toBe(pk);
    expect(queries.getAnnotationById(String(pk))?.id).toBe(pk);
  });

  test.each([
    "14F00000-0000-4000-8000-000000000099",
    "14f00000-0000-4000-8000-000000000099",
  ])("folds UUID case only for collections and annotations: %s", (uuid) => {
    const queries = fixture(uuid);
    const alternate = uuid.includes("F")
      ? uuid.toLowerCase()
      : uuid.toUpperCase();

    expect(queries.getCollectionById(alternate)?.id).toBe(99);
    expect(
      queries.getCollectionBooks(alternate).map((book) => book.id),
    ).toEqual([99]);
    expect(queries.getAnnotationById(alternate)?.id).toBe(99);
    expect(queries.getBookById(alternate)).toBeNull();
    expect(queries.getBookById(uuid)?.assetId).toBe(uuid);
  });

  test("keeps arbitrary slugs and mixed-case asset IDs case-sensitive", () => {
    const queries = fixture("MiXeD-Slug");
    expect(queries.getBookById("MiXeD-Slug")?.id).toBe(99);
    expect(queries.getBookById("mixed-slug")).toBeNull();
    expect(queries.getCollectionById("mixed-slug")).toBeNull();
    expect(queries.getCollectionBooks("mixed-slug")).toEqual([]);
    expect(queries.getAnnotationById("mixed-slug")).toBeNull();
    expect(queries.getAnnotationsByBookId("mixed-slug")).toEqual([]);
    expect(
      queries.getAnnotationsByBookId("MiXeD-Slug").map((row) => row.id),
    ).toEqual([99]);
  });

  test("resolves deleted natural identity before rejecting inactive rows", () => {
    const queries = fixture("14");
    queries.lib.run(
      `UPDATE ${Tables.Collections} SET ZDELETEDFLAG = 1 WHERE Z_PK = 99`,
    );
    queries.ann.run(
      `UPDATE ${Tables.Annotations} SET ZANNOTATIONDELETED = 1 WHERE Z_PK = 99`,
    );

    for (const id of ["14", "99"]) {
      expect(queries.getCollectionById(id)).toBeNull();
      expect(queries.getCollectionBooks(id)).toEqual([]);
      expect(queries.getAnnotationById(id)).toBeNull();
    }
    expect(queries.getCollectionById("unrelated")?.id).toBe(14);
    expect(queries.getAnnotationById("unrelated")?.id).toBe(14);
    expect(queries.listCollections().map((row) => row.id)).toEqual([14]);
    expect(queries.getAnnotationsByBookId("14")).toEqual([]);
  });
});
