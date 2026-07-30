/**
 * The currently published version of /terms and /privacy.
 *
 * Stored alongside each user's acceptance so that changing the documents can
 * re-prompt only the people who accepted an older version, instead of either
 * re-prompting everyone or silently treating a stale acceptance as current.
 *
 * Bump this (and only this) whenever /terms or /privacy changes materially.
 */
export const TERMS_VERSION = '2026-07-30'

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
