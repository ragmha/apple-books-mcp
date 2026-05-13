import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createDb } from "../src/db/query.ts";

const Row = z.object({ id: z.number(), name: z.string() });

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("CREATE TABLE t (id INTEGER, name TEXT)");
  for (let i = 1; i <= 5; i += 1) {
    db.run("INSERT INTO t (id, name) VALUES (?, ?)", [i, `row${i}`]);
  }
  return db;
}

describe("QueryBuilder.limit / offset safety", () => {
  test("rejects non-integer limits", () => {
    const db = createDb(makeDb());
    expect(() => db.selectFrom("t", Row).selectAll().limit(10.5)).toThrow(
      /integer/i,
    );
  });

  test("rejects negative limits", () => {
    const db = createDb(makeDb());
    expect(() => db.selectFrom("t", Row).selectAll().limit(-1)).toThrow(
      /positive integer/i,
    );
  });

  test("rejects zero as limit", () => {
    const db = createDb(makeDb());
    expect(() => db.selectFrom("t", Row).selectAll().limit(0)).toThrow(
      /positive integer/i,
    );
  });

  test("rejects negative offset", () => {
    const db = createDb(makeDb());
    expect(() => db.selectFrom("t", Row).selectAll().offset(-3)).toThrow(
      /non-negative integer/i,
    );
  });

  test("rejects non-integer offset", () => {
    const db = createDb(makeDb());
    expect(() => db.selectFrom("t", Row).selectAll().offset(2.7)).toThrow(
      /integer/i,
    );
  });

  test("accepts valid limit and offset and binds them as parameters (not interpolated)", () => {
    const db = createDb(makeDb());
    const rows = db
      .selectFrom("t", Row)
      .selectAll()
      .orderBy("id")
      .limit(2)
      .offset(2)
      .execute();
    expect(rows).toEqual([
      { id: 3, name: "row3" },
      { id: 4, name: "row4" },
    ]);
  });
});

describe("QueryBuilder.orderBy identifier allow-list", () => {
  test("rejects an obvious SQL-injection attempt", () => {
    const db = createDb(makeDb());
    expect(() =>
      db.selectFrom("t", Row).selectAll().orderBy("id; DROP TABLE t --"),
    ).toThrow(/identifier/i);
  });

  test("rejects a column starting with a digit", () => {
    const db = createDb(makeDb());
    expect(() => db.selectFrom("t", Row).selectAll().orderBy("1bad")).toThrow(
      /identifier/i,
    );
  });

  test("rejects an empty column", () => {
    const db = createDb(makeDb());
    expect(() => db.selectFrom("t", Row).selectAll().orderBy("")).toThrow(
      /identifier/i,
    );
  });

  test("accepts standard SQL identifiers like Z_PK and ZASSETID", () => {
    const db = createDb(makeDb());
    const rows = db
      .selectFrom("t", Row)
      .selectAll()
      .orderBy("id", "DESC")
      .execute();
    expect(rows.map((r) => r.id)).toEqual([5, 4, 3, 2, 1]);
  });
});
