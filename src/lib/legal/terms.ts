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

/** Minimum age, per GDPR Art. 8 as implemented in Latvia. */
export const MINIMUM_AGE = 16
