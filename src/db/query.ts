import { Database, type SQLQueryBindings } from "bun:sqlite";
import { z } from "zod";

/** Escape LIKE pattern special characters */
export function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
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
  private whereClauses: WhereClause[] = [];
  private orderClauses: OrderClause[] = [];
  private limitValue: number | null = null;
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

  /** WHERE column IS NULL */
  whereNull(column: string): this {
    return this.where(column, "IS", null);
  }

  /** WHERE column IS NOT NULL */
  whereNotNull(column: string): this {
    return this.where(column, "IS NOT", null);
  }

  join(table: string, on: string): this {
    this.joinClauses.push(`JOIN ${table} ON ${on}`);
    return this;
  }

  orderBy(column: string, direction: OrderDirection = "ASC"): this {
    this.orderClauses.push({ column, direction });
    return this;
  }

  limit(n: number): this {
    this.limitValue = n;
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
        let condition: string;
        if (w.value === null) {
          condition = `${w.column} ${w.operator} NULL`;
        } else {
          params.push(w.value as SQLQueryBindings);
          condition = `${w.column} ${w.operator} ?`;
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

    // Limit
    if (this.limitValue != null) {
      sql += ` LIMIT ${this.limitValue}`;
    }

    return { sql, params };
  }

  /** Execute and return all rows, validated against schema */
  all(): z.infer<T>[] {
    const { sql, params } = this.buildQuery();
    const stmt = this.db.query(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => this.schema.parse(row));
  }

  /** Execute and return first row, validated against schema */
  get(): z.infer<T> | null {
    const { sql, params } = this.buildQuery();
    const stmt = this.db.query(sql);
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
