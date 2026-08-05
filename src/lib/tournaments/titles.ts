/**
 * The `<title>` strings for the public tournament pages, as pure functions of
 * the two naming fields on `tournament_series`.
 *
 * A LEAF MODULE ON PURPOSE — it imports nothing. These live here rather than in
 * `./seo` because the admin naming editor is a client component and needs to
 * render the exact title an edit will produce, live as it is typed. `./seo`
 * imports `./series`, which imports the service-role Supabase client, so
 * pulling a helper from there into the browser bundle is not an option.
 *
 * The alternative — retyping the format string in the admin form — is worse
 * than showing no preview at all: the moment the two copies disagree, the panel
 * is showing an admin a title that never ships.
 */

/** The naming fields, structurally, so a form's in-progress values fit too. */
export type SeriesNaming = {
  name: string
  short_name: string | null
}

/**
 * Display name for a series, preferring the compact form in title tags.
 *
 * `short_name` is a deliberate trade: it buys room in the ~60-character SERP
 * budget by dropping words. That is right for "Queen's Club Championships" and
 * wrong for "Romanian Open" → "Bucharest" only if nobody searches the city —
 * which is a per-series judgement, not a rule, and is why /admin/tournaments/
 * series exists.
 */
export function seriesLabel(series: SeriesNaming, compact = false): string {
  return (compact ? series.short_name : null) ?? series.name
}

export function hubTitle(series: SeriesNaming): string {
  return `${seriesLabel(series, true)} — Draw, Results & Past Winners`
}

/** The title promises only what the page actually contains. */
export function editionTitle(series: SeriesNaming, year: number, isDone: boolean): string {
  const name = seriesLabel(series, true)
  return isDone
    ? `${name} ${year} — Results & Full Draw`
    : `${name} ${year} — Draw, Schedule & Results`
}

/**
 * Roughly where Google truncates a title in results.
 *
 * Google measures PIXELS (~600px), not characters, so this is an approximation
 * — but a character count is the only budget an admin can act on, and erring
 * low is the safe direction. The site-name suffix is excluded: Google drops it
 * first and its loss costs nothing.
 */
export const TITLE_BUDGET = 60
