/**
 * The currently published version of /terms and /privacy, as an ISO date.
 *
 * Stored alongside each user's acceptance so that changing the documents can
 * re-prompt only the people who accepted an older version, instead of either
 * re-prompting everyone or silently treating a stale acceptance as current.
 *
 * This is the single source of truth for the date, and both legal pages render
 * their "Last updated" line from it. Keeping the displayed date in the page and
 * the recorded version in here as two separate literals is how you end up
 * recording acceptances against a version of the documents that never existed.
 *
 * Bump this (and only this) whenever /terms or /privacy changes materially.
 */
export const TERMS_VERSION = '2026-03-25'

/**
 * TERMS_VERSION formatted for display, e.g. "March 25, 2026".
 *
 * timeZone: 'UTC' is required, not cosmetic: an ISO date-only string parses as
 * UTC midnight, so formatting it in a negative-offset timezone would render the
 * previous day and make the page contradict the version it was derived from.
 */
export const TERMS_LAST_UPDATED_LABEL = new Date(`${TERMS_VERSION}T00:00:00Z`).toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

/** Shape a version string must have to be trusted from a URL. */
const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate a version that arrived in a redirect URL before it is written to the
 * database. The value is user-editable, so without this a hand-crafted callback
 * could store arbitrary text in users.terms_version — junk that would then be
 * indistinguishable from a real acceptance when auditing.
 *
 * Returns the version, or null if it is missing or malformed.
 */
export function parseAcceptedVersion(raw: string | null): string | null {
  if (!raw || !VERSION_PATTERN.test(raw)) return null
  return raw
}
