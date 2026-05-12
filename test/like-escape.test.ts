import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { escapeLikePattern } from "../src/db/query.ts";

/**
 * Regression test for LIKE pattern escaping. Without `ESCAPE '\\'`, the
 * literal `100%` would match `1000` because `%` is the wildcard. The
 * query-builder's `whereLike` always emits the ESCAPE clause; this test
 * pins down the behaviour and documents why the escape character matters.
 */
describe("LIKE pattern escaping", () => {
  function setup() {
    const db = new Database(":memory:");
    db.run("CREATE TABLE test (col TEXT)");
    db.run("INSERT INTO test VALUES ('100%')");
    db.run("INSERT INTO test VALUES ('1000')");
    return db;
  }

  test("WITHOUT ESCAPE, the raw '%' wildcard makes '100%' match '1000' too (the bug the ESCAPE clause fixes)", () => {
    const db = setup();
    // Naive concat: %100%% — second % is an unescaped wildcard.
    const pattern = `%100%%`;
    const rows = db
      .query<{ col: string }, [string]>("SELECT * FROM test WHERE col LIKE ?")
      .all(pattern);
    expect(rows).toEqual([{ col: "100%" }, { col: "1000" }]);
  });

  test("WITH ESCAPE, '100%' matches only '100%' (the fix the codebase uses)", () => {
    const db = setup();
    const pattern = `%${escapeLikePattern("100%")}%`;
    const rows = db
      .query<
        { col: string },
        [string]
      >("SELECT * FROM test WHERE col LIKE ? ESCAPE '\\'")
      .all(pattern);
    expect(rows).toEqual([{ col: "100%" }]);
  });
});
