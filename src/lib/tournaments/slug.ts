/**
 * Series slug rules.
 *
 * These mirror the CHECK constraints in 072_tournament_series.sql exactly. The
 * database is the enforcement point — no code path, cron or hand-edit can
 * create a URL that breaks the contract — and this module exists so the admin
 * form can reject a bad slug before the round trip rather than surfacing a
 * Postgres constraint error.
 *
 * A slug is written ONCE and never recomputed. There is deliberately no
 * "rename" helper here: changing a slug silently breaks every backlink and
 * every crawler's record of the URL, which is the whole thing the series table
 * exists to prevent.
 */

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const SLUG_MIN_LENGTH = 2
export const SLUG_MAX_LENGTH = 60

/**
 * Route segments that live alongside `[slug]` under /tournaments. A series
 * claiming one of these would be shadowed by the static route and unreachable.
 */
const RESERVED_SLUGS = new Set(['predict', 'picks', 'results', 'upcoming', 'new', 'all'])

/** Characters that carry meaning in tennis names but have no URL form. */
const TRANSLITERATIONS: Record<string, string> = {
  ä: 'a', å: 'a', á: 'a', à: 'a', â: 'a', ã: 'a',
  ë: 'e', é: 'e', è: 'e', ê: 'e',
  ï: 'i', í: 'i', ì: 'i', î: 'i',
  ö: 'o', ó: 'o', ò: 'o', ô: 'o', õ: 'o', ø: 'o',
  ü: 'u', ú: 'u', ù: 'u', û: 'u',
  ç: 'c', ñ: 'n', ß: 'ss', ț: 't', ș: 's', ł: 'l',
}

/**
 * Best-effort slug from a tournament name — a STARTING POINT for the admin
 * form, never the final answer.
 *
 * Deliberately not used unattended: on the 34 tournaments in the table today
 * this produces the wrong URL for 22 of them, because the stored name is a
 * title sponsor ("Terra Wortmann Open" for Halle, "HSBC Championships" for
 * Queen's Club). The admin always sees and can overwrite the suggestion.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äåáàâãëéèêïíìîöóòôõøüúùûçñßțșł]/g, ch => TRANSLITERATIONS[ch] ?? ch)
    // Strip accents the map above missed, without dropping the base letter.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // "Fayez Sarofim & Co." → "fayez sarofim and co"
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    // A trailing hyphen can reappear after the length clamp.
    .replace(/-+$/, '')
}

export type SlugProblem =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'format'
  | 'uuid_shaped'
  | 'reserved'

/**
 * Why a slug is unacceptable, or null when it is fine.
 *
 * Uniqueness is NOT checked here — that is the database's unique index, which
 * is the only place it can be decided without a race.
 */
export function slugProblem(slug: string): SlugProblem | null {
  if (!slug) return 'empty'
  if (slug.length < SLUG_MIN_LENGTH) return 'too_short'
  if (slug.length > SLUG_MAX_LENGTH) return 'too_long'
  if (!KEBAB.test(slug)) return 'format'
  // /tournaments/[slug] treats a UUID-shaped param as a legacy tournament id
  // and redirects it, so a UUID-shaped slug would never resolve to its series.
  // It passes the kebab test, so it needs its own guard.
  if (UUID.test(slug)) return 'uuid_shaped'
  if (RESERVED_SLUGS.has(slug)) return 'reserved'
  return null
}

export function isValidSlug(slug: string): boolean {
  return slugProblem(slug) === null
}

const PROBLEM_MESSAGES: Record<SlugProblem, string> = {
  empty: 'Enter a URL slug.',
  too_short: `Must be at least ${SLUG_MIN_LENGTH} characters.`,
  too_long: `Must be ${SLUG_MAX_LENGTH} characters or fewer.`,
  format: 'Use lowercase letters, numbers and single hyphens only (e.g. "halle-open").',
  uuid_shaped: 'Cannot look like a UUID — that form is reserved for legacy tournament links.',
  reserved: 'That word is reserved by another page under /tournaments.',
}

export function slugErrorMessage(slug: string): string | null {
  const problem = slugProblem(slug)
  return problem ? PROBLEM_MESSAGES[problem] : null
}

/** True when a /tournaments/[slug] param is a legacy tournament UUID. */
export function isUuid(value: string): boolean {
  return UUID.test(value)
}

/**
 * Editions are addressed by four-digit year. Validating here rather than
 * letting any string through matters: without it /tournaments/wimbledon/predcit
 * would render a 200 empty page instead of a 404, which is exactly the kind of
 * soft-404 that degrades crawl quality at scale.
 */
export function parseEditionYear(value: string): number | null {
  if (!/^(19|20)\d{2}$/.test(value)) return null
  return Number(value)
}
