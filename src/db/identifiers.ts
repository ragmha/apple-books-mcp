import type { SQLQueryBindings } from "bun:sqlite";
import { assertSqlIdentifier } from "./query.ts";

type NaturalKey = "ZASSETID" | "ZCOLLECTIONID" | "ZANNOTATIONUUID";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Leading zeros are allowed, but signs, prefixes and unsafe integers are not. */
export function parseInternalPk(id: string): number | undefined {
  if (!/^[0-9]+$/.test(id)) return undefined;
  const pk = Number(id);
  return Number.isSafeInteger(pk) && pk > 0 ? pk : undefined;
}

/**
 * The lookup must include deleted rows: a deleted natural key still owns its
 * identity and must never fall through to an unrelated active primary key.
 */
export function resolveIdentifier<T>(
  id: string,
  naturalKey: NaturalKey,
  lookup: (predicate: string, params: SQLQueryBindings[]) => T | null,
): T | null {
  assertSqlIdentifier(naturalKey, "natural key");
  const exact = lookup(`${naturalKey} = ? COLLATE BINARY`, [id]);
  if (exact) return exact;

  if (naturalKey !== "ZASSETID" && UUID.test(id)) {
    const uuid = lookup(`${naturalKey} = ? COLLATE NOCASE`, [id]);
    if (uuid) return uuid;
  }

  const pk = parseInternalPk(id);
  return pk === undefined ? null : lookup("Z_PK = ?", [pk]);
}
