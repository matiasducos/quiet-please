import { createAdminClient } from '@/lib/supabase/admin'
import { cardHighlights } from './recap-types'
import type { Highlight, RecapPayload } from './recap-types'

/**
 * The end-of-tournament recap — read and write side.
 *
 * The heavy lifting happens once, in `build_tournament_recap()` (migration
 * 076), because answering "who did everyone back" means expanding the picks
 * jsonb of every global bracket in the tournament. Everything here reads the
 * stored result, so the homepage costs one indexed row lookup no matter how
 * many users the app has.
 *
 * Shapes and formatting live in `./recap-types`, which stays free of server
 * imports so client components can render a payload. Rows are typed by hand:
 * `src/types/database.ts` is a `Record<string, any>` placeholder (the project
 * is not linked locally, so `supabase gen types` cannot run), which means every
 * Supabase call returns `any`. Declaring the shape at this boundary is what
 * keeps the pages free of `any` — the same approach `./series.ts` takes.
 */

export type { RecapPayload, RecapPlayer, Highlight } from './recap-types'
export { cardHighlights, playerLabel, roundName, MIN_SAMPLE } from './recap-types'

type Admin = ReturnType<typeof createAdminClient>

export interface TournamentRecap {
  tournamentId: string
  payload: RecapPayload
  builtAt: string
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * `tournament_recaps` is publicly readable, so this borrows no privilege it
 * does not already have — the admin client is used because the callers are
 * cached, statically rendered pages. The request-scoped client reads cookies,
 * which would opt the homepage out of static rendering to fetch a row that is
 * byte-identical for every visitor.
 */
export async function getRecap(tournamentId: string): Promise<TournamentRecap | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tournament_recaps')
    .select('tournament_id, payload, built_at')
    .eq('tournament_id', tournamentId)
    .maybeSingle()

  if (error) {
    console.error('[recap] getRecap failed:', error.message)
    return null
  }
  if (!data) return null

  return {
    tournamentId: data.tournament_id,
    payload: data.payload as RecapPayload,
    builtAt: data.built_at,
  }
}

/** Batch variant — one round trip for a list of tournaments. */
export async function getRecaps(tournamentIds: string[]): Promise<Map<string, TournamentRecap>> {
  const out = new Map<string, TournamentRecap>()
  if (tournamentIds.length === 0) return out

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tournament_recaps')
    .select('tournament_id, payload, built_at')
    .in('tournament_id', tournamentIds)

  if (error) {
    console.error('[recap] getRecaps failed:', error.message)
    return out
  }

  for (const row of (data ?? []) as Array<{ tournament_id: string; payload: RecapPayload; built_at: string }>) {
    out.set(row.tournament_id, {
      tournamentId: row.tournament_id,
      payload: row.payload,
      builtAt: row.built_at,
    })
  }
  return out
}

export interface RecentTournament {
  id: string
  name: string
  location: string | null
  flag_emoji: string | null
  tour: string
  category: string
  surface: string | null
  starts_at: string | null
  ends_at: string | null
  status: string
  /** Series slug + year, for the recap link. Null on a tournament with no series. */
  slug: string | null
  year: number | null
  recap: RecapPayload | null
}

/**
 * The most recently finished tournaments, newest first.
 *
 * Deliberately NOT windowed to the last seven days. Tennis has quiet weeks and
 * a three-month off-season, and a homepage section that vanishes for a third of
 * the year teaches visitors the app is dormant. Showing the last three finished
 * events whenever they happened keeps the proof of life on the page; every card
 * carries its own dates, so nothing here claims to be more recent than it is.
 *
 * `nullsFirst: false` matters: Postgres sorts NULLs first under DESC, so a
 * completed tournament with no end date would otherwise pin itself to the top
 * of the homepage permanently.
 */
export async function getRecentCompleted(limit = 3): Promise<RecentTournament[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('tournaments')
    .select('id, name, location, flag_emoji, tour, category, surface, starts_at, ends_at, status, starts_year, tournament_series(slug)')
    .eq('status', 'completed')
    .order('ends_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) {
    console.error('[recap] getRecentCompleted failed:', error.message)
    return []
  }

  const rows = (data ?? []) as Array<{
    id: string
    name: string
    location: string | null
    flag_emoji: string | null
    tour: string
    category: string
    surface: string | null
    starts_at: string | null
    ends_at: string | null
    status: string
    starts_year: number | null
    tournament_series?: { slug: string } | { slug: string }[] | null
  }>

  const recaps = await getRecaps(rows.map(r => r.id))

  return rows.map(r => {
    const embedded = r.tournament_series
    const slug = Array.isArray(embedded) ? embedded[0]?.slug ?? null : embedded?.slug ?? null
    return {
      id: r.id,
      name: r.name,
      location: r.location,
      flag_emoji: r.flag_emoji,
      tour: r.tour,
      category: r.category,
      surface: r.surface,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      status: r.status,
      slug,
      year: r.starts_year,
      recap: recaps.get(r.id)?.payload ?? null,
    }
  })
}

/**
 * The recap URL for an edition, or null when there is nowhere to send people.
 *
 * A tournament with no series has no canonical `/tournaments/<slug>/<year>`
 * URL, so there is no recap route either — linking one would 404. Every caller
 * that renders a recap link goes through here rather than building the path
 * inline, so that check cannot be forgotten in one place and not another.
 */
export function recapHref(slug: string | null, year: number | null): string | null {
  if (!slug || year == null) return null
  return `/tournaments/${slug}/${year}/recap`
}

/**
 * Attach formatted recap lines and a link to a list of tournaments.
 *
 * Shared by the homepage and the tournaments list so the two cannot drift into
 * showing different stats for the same tournament. Only completed tournaments
 * are looked up — nothing else can have a recap — which also keeps the `.in()`
 * filter down to the rows that could match.
 */
export async function withRecaps<T extends { id: string; status: string; slug?: string | null; year?: number | null }>(
  tournaments: T[],
): Promise<Array<T & { recap_highlights: Highlight[]; recap_href: string | null }>> {
  const completedIds = tournaments.filter(t => t.status === 'completed').map(t => t.id)
  const recaps = await getRecaps(completedIds)

  return tournaments.map(t => {
    const payload = recaps.get(t.id)?.payload ?? null
    const highlights = cardHighlights(payload)
    return {
      ...t,
      recap_highlights: highlights,
      // No stats means no link: see the matching guard in TournamentCard.
      recap_href: highlights.length > 0 ? recapHref(t.slug ?? null, t.year ?? null) : null,
    }
  })
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Compute and store the recap. Service-role only — `build_tournament_recap`
 * reads every user's picks, and is granted to service_role alone.
 *
 * Idempotent by upsert: completion can be triggered more than once (an admin
 * flips the status, an admin later rebuilds), and the second call should
 * refresh the row rather than conflict on the primary key.
 */
export async function buildAndStoreRecap(
  tournamentId: string,
  admin: Admin = createAdminClient(),
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin.rpc('build_tournament_recap', { t_id: tournamentId })

  if (error) {
    console.error('[recap] build failed:', error.message)
    return { ok: false, error: error.message }
  }
  // A payload is never literally empty — it always carries `version` and
  // `built_at` — so "is there anything to say" has to be asked of the data.
  // Both halves are load-bearing: no matches means no tournament to describe,
  // and no brackets means there is no crowd whose picks the whole feature is
  // about. Either way the recap page would render a strip of zeros.
  //
  // Storing nothing is also what schedules the retry: the cron builds recaps
  // for completed tournaments that have no row, so a tournament whose results
  // are entered later gets picked up on a subsequent run.
  const payload = data as RecapPayload | null
  const matches = payload?.participation?.matches ?? 0
  const brackets = payload?.participation?.brackets ?? 0
  if (!payload || matches === 0 || brackets === 0) {
    return {
      ok: false,
      error: matches === 0
        ? 'Nothing to summarise — no results entered for this tournament'
        : 'Nothing to summarise — no brackets were entered for this tournament',
    }
  }

  const { error: writeError } = await admin
    .from('tournament_recaps')
    .upsert(
      { tournament_id: tournamentId, payload, built_at: new Date().toISOString() },
      { onConflict: 'tournament_id' },
    )

  if (writeError) {
    console.error('[recap] store failed:', writeError.message)
    return { ok: false, error: writeError.message }
  }
  return { ok: true }
}

/**
 * Drop the recap. Called when a completion is reverted or the ledger is wiped
 * for a re-score: the recap asserts a champion and a final podium, and leaving
 * it in place would keep making that claim after the data behind it changed.
 */
export async function deleteRecap(
  tournamentId: string,
  admin: Admin = createAdminClient(),
): Promise<void> {
  const { error } = await admin.from('tournament_recaps').delete().eq('tournament_id', tournamentId)
  if (error) console.error('[recap] delete failed:', error.message)
}
