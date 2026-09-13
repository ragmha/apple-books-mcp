import type { Database } from "bun:sqlite";
import { EntityTypes, Tables } from "./constants.ts";
import {
  AnnotationRowSchema,
  BookRowSchema,
  CollectionRowSchema,
} from "./schemas.ts";

/**
 * Result of a schema-validation pass against the writable Library DB.
 * Returned (rather than thrown) so callers can decide whether to refuse
 * writes, log a warning, or fall back to read-only mode.
 */
export type SchemaCheckResult = { ok: true } | { ok: false; message: string };

/**
 * Minimum tables and columns the codebase relies on. If Apple's Core Data
 * schema changes between macOS releases (it has before), validating these at
 * startup turns a silent corruption risk into a loud error message.
 */
const REQUIRED: Array<{ table: string; columns: string[] }> = [
  {
    table: Tables.Books,
    columns: [...Object.keys(BookRowSchema.shape), "Z_ENT", "Z_OPT"],
  },
  {
    table: Tables.Collections,
    columns: [
      ...Object.keys(CollectionRowSchema.shape),
      "Z_ENT",
      "Z_OPT",
      "ZLOCALMODDATE",
    ],
  },
  {
    table: Tables.CollectionMembers,
    columns: [
      "Z_PK",
      "Z_ENT",
      "Z_OPT",
      "ZSORTKEY",
      "ZASSET",
      "ZCOLLECTION",
      "ZASSETID",
      "ZLOCALMODDATE",
    ],
  },
  { table: Tables.PrimaryKey, columns: ["Z_ENT", "Z_NAME", "Z_MAX"] },
];

const REQUIRED_ANNOTATIONS: Array<{ table: string; columns: string[] }> = [
  {
    table: Tables.Annotations,
    columns: [...Object.keys(AnnotationRowSchema.shape), "Z_ENT", "Z_OPT"],
  },
  { table: Tables.PrimaryKey, columns: ["Z_ENT", "Z_NAME", "Z_MAX"] },
];

export function validateLibrarySchema(db: Database): SchemaCheckResult {
  const label = "Apple Books library";
  const columns = runSchemaCheck(db, REQUIRED, label);
  if (!columns.ok) return columns;

  const problems: string[] = [];
  for (const { table, entity, name } of [
    {
      table: Tables.Collections,
      entity: EntityTypes.Collection,
      name: "BKCollection",
    },
    {
      table: Tables.CollectionMembers,
      entity: EntityTypes.CollectionMember,
      name: "BKCollectionMember",
    },
  ]) {
    const rows = db
      .query<
        { Z_ENT: unknown; Z_NAME: unknown; Z_MAX: unknown },
        [number, string]
      >(
        `SELECT Z_ENT, Z_NAME, Z_MAX FROM ${Tables.PrimaryKey}
         WHERE Z_ENT = ? OR Z_NAME = ?`,
      )
      .all(entity, name);
    const row = rows[0];
    if (
      rows.length !== 1 ||
      !row ||
      row.Z_ENT !== entity ||
      row.Z_NAME !== name
    ) {
      problems.push(
        `unsupported ${Tables.PrimaryKey} mapping: expected ${name} at Z_ENT ${entity}`,
      );
      continue;
    }

    const highestPk = db
      .query<{ pk: unknown }, []>(`SELECT MAX(Z_PK) AS pk FROM ${table}`)
      .get()?.pk;
    if (
      typeof row.Z_MAX !== "number" ||
      !Number.isSafeInteger(row.Z_MAX) ||
      row.Z_MAX < 0 ||
      row.Z_MAX >= Number.MAX_SAFE_INTEGER ||
      (highestPk !== null &&
        (typeof highestPk !== "number" ||
          !Number.isSafeInteger(highestPk) ||
          highestPk < 0 ||
          row.Z_MAX < highestPk))
    ) {
      problems.push(`invalid ${Tables.PrimaryKey}.Z_MAX for ${name}`);
    }
  }
  return schemaCheckResult(label, problems);
}

export function validateAnnotationSchema(db: Database): SchemaCheckResult {
  return runSchemaCheck(db, REQUIRED_ANNOTATIONS, "Apple Books annotations");
}

function runSchemaCheck(
  db: Database,
  required: Array<{ table: string; columns: string[] }>,
  label: string,
): SchemaCheckResult {
  const tables = new Set(
    db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table'",
      )
      .all()
      .map((r) => r.name),
  );

  const problems: string[] = [];

  for (const req of required) {
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

  return schemaCheckResult(label, problems);
}

function schemaCheckResult(
  label: string,
  problems: string[],
): SchemaCheckResult {
  if (problems.length === 0) return { ok: true };
  return {
    ok: false,
    message:
      `${label} schema validation failed; the codebase expects Core Data ` +
      "tables, columns and allocator metadata that are not supported. A macOS " +
      "update may have changed the schema. Details: " +
      problems.join("; "),
  };
}
