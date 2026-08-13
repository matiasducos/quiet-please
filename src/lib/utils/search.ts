/**
 * Shared rules for the username search boxes on the leaderboards.
 *
 * Both boards — global and per-tournament — have to agree on what counts as a
 * search, or the same typed term filters one and not the other.
 */

/** Below this a search matches most of the board, so it stays off. */
export const MIN_SEARCH_LENGTH = 2

/** Max hits shown. Each one costs a rank count, so it is capped. */
export const SEARCH_LIMIT = 10

/**
 * Drops the characters that mean something to LIKE or to PostgREST's filter
 * grammar. Usernames contain none of them, so stripping is both safer and
 * simpler than escaping — an unescaped `%` would otherwise match every row.
 */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[%_\\(),*]/g, '').trim().slice(0, 40)
}

/** True when `term` (already sanitized) should replace the board with results. */
export function isSearchActive(term: string): boolean {
  return term.length >= MIN_SEARCH_LENGTH
}
