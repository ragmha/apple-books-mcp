import type { Database } from "bun:sqlite";
import { Tables } from "./constants.ts";

/**
 * Result of a schema-validation pass against the writable Library DB.
 * Returned (rather than thrown) so callers can decide whether to refuse
 * writes, log a warning, or fall back to read-only mode.
 */
export type SchemaCheckResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Minimum tables and columns the codebase relies on. If Apple's Core Data
 * schema changes between macOS releases (it has before), validating these at
 * startup turns a silent corruption risk into a loud error message.
 */
const REQUIRED: Array<{ table: string; columns: string[] }> = [
  {
    table: Tables.Books,
    columns: ["Z_PK", "Z_ENT", "Z_OPT", "ZASSETID", "ZTITLE"],
  },
  {
    table: Tables.Collections,
    columns: [
      "Z_PK",
      "Z_ENT",
      "Z_OPT",
      "ZTITLE",
      "ZCOLLECTIONID",
      "ZDELETEDFLAG",
    ],
  },
  { table: "Z_PRIMARYKEY", columns: ["Z_ENT", "Z_NAME", "Z_MAX"] },
];

export function validateLibrarySchema(db: Database): SchemaCheckResult {
  const tables = new Set(
    db
      .query<
        { name: string },
        []
      >("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name),
  );

  const problems: string[] = [];

  for (const req of REQUIRED) {
    if (!tables.has(req.table)) {
      problems.push(`missing table: ${req.table}`);
      continue;
    }
    const cols = new Set(
      db
        .query<{ name: string }, []>(`PRAGMA table_info(${req.table})`)
        .all()
        .map((r) => r.name),
    );
    for (const col of req.columns) {
      if (!cols.has(col)) {
        problems.push(`missing column: ${req.table}.${col}`);
      }
    }
  }

  if (problems.length === 0) return { ok: true };
  return {
    ok: false,
    message:
      "Apple Books schema validation failed; the codebase expects Core Data " +
      "tables/columns that are not present. This usually means a macOS " +
      "update changed the schema. Details: " +
      problems.join("; "),
  };
}
