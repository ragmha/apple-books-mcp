const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function resolvePagination(limit = DEFAULT_LIMIT, offset = 0) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("limit must be a positive safe integer");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("offset must be a non-negative safe integer");
  }
  return { limit: Math.min(limit, MAX_LIMIT), offset };
}
