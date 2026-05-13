/**
 * Apple Books uses Core Data, whose timestamp epoch is 2001-01-01 00:00:00
 * UTC (not the Unix epoch). Every `Z*DATE` column stores seconds since that
 * moment as a REAL.
 *
 * Centralised here so a single off-by-one in the epoch can't sneak into
 * one of three duplicates spread across the codebase.
 */
export const CORE_DATA_EPOCH_OFFSET_S = Date.UTC(2001, 0, 1) / 1000;

/** Wall-clock "now" as a Core Data timestamp (seconds since 2001-01-01). */
export function coreDataNow(): number {
  return Date.now() / 1000 - CORE_DATA_EPOCH_OFFSET_S;
}

/** Convert a Core Data timestamp to an ISO-8601 string, or null if absent. */
export function coreDataToISO(timestamp: number | null | undefined): string | null {
  if (timestamp == null) return null;
  return new Date((timestamp + CORE_DATA_EPOCH_OFFSET_S) * 1000).toISOString();
}
