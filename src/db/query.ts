import { Database, type SQLQueryBindings } from "bun:sqlite";
import { z } from "zod";

/** Escape LIKE pattern special characters */
export function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}

/**
 * Allow-list check for any string we will splice into SQL as an identifier
 * (table name, column name, JOIN target). Apple Books' Core Data identifiers
 * are all of the form `Z_*` or `Z<UPPER>*` plus `_` and digits, which fits
 * the standard SQL identifier shape. Throwing here is the difference between
 * "string interpolation is safe because the only callers pass constants" and
 * "string interpolation is safe because the API enforces it."
 */
export function assertSqlIdentifier(s: string, role: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
    throw new Error(`Invalid SQL identifier for ${role}: ${JSON.stringify(s)}`);
  }
}

type WhereOperator =
  | "="
  | "!="
  | "LIKE"
  | ">"
  | "<"
  | ">="
  | "<="
  | "IS"
  | "IS NOT";
type OrderDirection = "ASC" | "DESC";

interface WhereClause {
  column: string;
  operator: WhereOperator;
  value: unknown;
  connector?: "AND" | "OR";
}

interface RawWhereClause {
  raw: string;
  params: SQLQueryBindings[];
  connector: "AND" | "OR";
}

interface OrderClause {
  column: string;
  direction: OrderDirection;
}

/**
 * Fluent query builder with Zod schema validation
 */
export class QueryBuilder<T extends z.ZodType> {
  private db: Database;
  private schema: T;
  private tableName: string;
  private columns: string[] = ["*"];
  private whereClauses: (WhereClause | RawWhereClause)[] = [];
  private orderClauses: OrderClause[] = [];
  private stmtCache = new Map<string, ReturnType<Database["query"]>>();
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private joinClauses: string[] = [];

  constructor(db: Database, schema: T, table: string) {
    this.db = db;
    this.schema = schema;
    this.tableName = table;
  }

  select(...cols: string[]): this {
    this.columns = cols;
    return this;
  }

  selectAll(): this {
    this.columns = ["*"];
    return this;
  }

  where(column: string, operator: WhereOperator, value: unknown): this {
    this.whereClauses.push({ column, operator, value, connector: "AND" });
    return this;
  }

  orWhere(column: string, operator: WhereOperator, value: unknown): this {
    this.whereClauses.push({ column, operator, value, connector: "OR" });
    return this;
  }

  /** Convenience: WHERE column LIKE '%pattern%' with proper escaping */
  whereLike(column: string, pattern: string): this {
    const escaped = `%${escapeLikePattern(pattern)}%`;
    return this.where(column, "LIKE", escaped);
  }

  orWhereLike(column: string, pattern: string): this {
    const escaped = `%${escapeLikePattern(pattern)}%`;
    return this.orWhere(column, "LIKE", escaped);
  }

  /** Inject a raw SQL condition with AND connector */
  whereRaw(sql: string, params: SQLQueryBindings[] = []): this {
    this.whereClauses.push({ raw: sql, params, connector: "AND" });
    return this;
  }

  /** WHERE column IS NULL */
  whereNull(column: string): this {
    return this.where(column, "IS", null);
  }

  /** WHERE column IS NOT NULL */
  whereNotNull(column: string): this {
    return this.where(column, "IS NOT", null);
  }

  join(table: string, on: string): this {
    assertSqlIdentifier(table, "join table");
    // ON clause is structurally complex (column = column); validate each
    // identifier in the clause rather than allow-list the whole thing.
    for (const ident of on.split(/[^A-Za-z0-9_.]+/).filter(Boolean)) {
      // Allow `table.column` for join predicates.
      for (const part of ident.split(".")) {
        if (part) assertSqlIdentifier(part, "join ON identifier");
      }
    }
    this.joinClauses.push(`JOIN ${table} ON ${on}`);
    return this;
  }

  orderBy(column: string, direction: OrderDirection = "ASC"): this {
    assertSqlIdentifier(column, "orderBy column");
    this.orderClauses.push({ column, direction });
    return this;
  }

  limit(n: number): this {
    if (!Number.isInteger(n)) {
      throw new Error(`limit must be an integer (got ${n})`);
    }
    if (n < 1) {
      throw new Error(`limit must be a positive integer (got ${n})`);
    }
    this.limitValue = n;
    return this;
  }

  offset(n: number): this {
    if (!Number.isInteger(n)) {
      throw new Error(`offset must be an integer (got ${n})`);
    }
    if (n < 0) {
      throw new Error(`offset must be a non-negative integer (got ${n})`);
    }
    this.offsetValue = n;
    return this;
  }

  private buildQuery(): { sql: string; params: SQLQueryBindings[] } {
    const params: SQLQueryBindings[] = [];
    const selectCols = this.columns.join(", ");
    let sql = `SELECT ${selectCols} FROM ${this.tableName}`;

    // Joins
    if (this.joinClauses.length > 0) {
      sql += " " + this.joinClauses.join(" ");
    }

    // Where
    if (this.whereClauses.length > 0) {
      const conditions = this.whereClauses.map((w, i) => {
        if ("raw" in w) {
          params.push(...w.params);
          const condition = w.raw;
          return i === 0 ? condition : `${w.connector} ${condition}`;
        }
        let condition: string;
        if (w.value === null) {
          condition = `${w.column} ${w.operator} NULL`;
        } else {
          params.push(w.value as SQLQueryBindings);
          condition =
            w.operator === "LIKE"
              ? `${w.column} ${w.operator} ? ESCAPE '\\'`
              : `${w.column} ${w.operator} ?`;
        }
        return i === 0 ? condition : `${w.connector} ${condition}`;
      });
      sql += " WHERE " + conditions.join(" ");
    }

    // Order
    if (this.orderClauses.length > 0) {
      const orders = this.orderClauses.map((o) => `${o.column} ${o.direction}`);
      sql += " ORDER BY " + orders.join(", ");
    }

    // Limit & Offset — bound as parameters, never interpolated. The
    // numeric guards in `limit`/`offset` are belt-and-braces; SQLite
    // accepts `?` here in 3.42+.
    if (this.limitValue != null) {
      sql += " LIMIT ?";
      params.push(this.limitValue);
    }
    if (this.offsetValue != null) {
      sql += " OFFSET ?";
      params.push(this.offsetValue);
    }

    return { sql, params };
  }

  private getOrPrepare(sql: string): ReturnType<Database["query"]> {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.query(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  /** Execute and return all rows, validated against schema */
  all(): z.infer<T>[] {
    const { sql, params } = this.buildQuery();
    const stmt = this.getOrPrepare(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => this.schema.parse(row));
  }

  /** Execute and return first row, validated against schema */
  get(): z.infer<T> | null {
    const { sql, params } = this.buildQuery();
    const stmt = this.getOrPrepare(sql);
    const row = stmt.get(...params);
    return row ? this.schema.parse(row) : null;
  }

  /** Alias for all() to match Kysely API */
  execute(): z.infer<T>[] {
    return this.all();
  }
}

/**
 * Create a typed query builder factory for a database
 */
export function createDb(db: Database) {
  return {
    selectFrom<T extends z.ZodType>(table: string, schema: T): QueryBuilder<T> {
      return new QueryBuilder(db, schema, table);
    },
  };
}
