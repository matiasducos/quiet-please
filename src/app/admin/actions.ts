'use server'

import { revalidateTag } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient, listAllUsers } from '@/lib/supabase/admin'
import { announceDrawOpen } from '@/lib/announce-draw-open'
import { buildAndStoreRecap, deleteRecap } from '@/lib/tournaments/recap'
import { slugErrorMessage } from '@/lib/tournaments/slug'
import { qualifierSlotId, remapResolvedQualifiers, type DrawLike } from '@/lib/tennis/qualifier-remap'
import { unpaidRounds } from '@/lib/tennis/points'
import { COUNTRIES, codeToFlag } from './countries'

/** Look up a country name and return its flag emoji, or null if not found. */
function flagForCountry(countryName: string): string | null {
  const trimmed = countryName.trim().toLowerCase()
  const match = COUNTRIES.find(c => c.name.toLowerCase() === trimmed)
  return match ? codeToFlag(match.code) : null
}

// ── Auth guard ────────────────────────────────────────────────────────────────
// Lives in ./auth so the users panel shares one definition of "is an admin".
import { assertAdmin } from './auth'

function getBaseUrl(): string {
  // In dev: localhost. In prod: use NEXT_PUBLIC_BASE_URL or VERCEL_URL.
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

// ── Test notifications ────────────────────────────────────────────────────────

import type { NotificationType } from './constants'

export async function sendTestNotification(
  type: NotificationType,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()
  try {
    const allUsers = await listAllUsers(admin)
    if (!allUsers.length) return { ok: true, count: 0 }

    const meta: Record<string, unknown> = {
      test:                true,
      tournament_name:     'Test Tournament',
      challenger_username: 'test_user',
      from_username:       'test_user',
      friend_username:     'test_user',
      username:            'test_user',
      points:              100,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = allUsers.map((u: any) => ({
      user_id: u.id,
      type,
      meta,
    }))

    const { error } = await admin.from('notifications').insert(rows)
    if (error) return { ok: false, error: error.message }
    return { ok: true, count: allUsers.length }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ── Cron trigger ──────────────────────────────────────────────────────────────

export async function triggerCron(key: string, params?: Record<string, string>): Promise<{ ok: boolean; data: unknown }> {
  await assertAdmin()
  const cronSecret = process.env.CRON_SECRET
  const headers: Record<string, string> = cronSecret
    ? { Authorization: `Bearer ${cronSecret}` }
    : {}
  const qs = params ? `?${new URLSearchParams(params).toString()}` : ''
  try {
    const res = await fetch(`${getBaseUrl()}/api/cron/${key}${qs}`, {
      headers,
      cache: 'no-store',
      // Give cron routes enough time; still bounded by the Vercel function limit.
      signal: AbortSignal.timeout(55_000),
    })
    const data = await res.json().catch(() => ({ error: 'Non-JSON response' }))
    return { ok: res.ok, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, data: { error: message } }
  }
}

// ── Tournament status override ────────────────────────────────────────────────

// `draw_published` is included because `sync-draws` sets it (a qualifying draw
// with no named players yet), so it is a state a tournament can genuinely be in
// and therefore one an admin must be able to set it back to. The API route at
// /api/admin/set-tournament-status has always accepted it; this action was the
// odd one out.
const VALID_STATUSES = ['upcoming', 'draw_published', 'accepting_predictions', 'in_progress', 'completed'] as const
type ValidStatus = typeof VALID_STATUSES[number]

/**
 * The statuses a draw save is allowed to move to `accepting_predictions`.
 *
 * Publishing a draw opens predictions, but a draw is also RE-saved routinely —
 * a qualifier resolves, a withdrawal reshuffles a section. Both publish paths
 * used to rewrite the status unconditionally, so re-saving the draw of a
 * tournament that was already under way dragged it backwards. Cincinnati 2026
 * spent a day like that: the first result flipped it to `in_progress` at 23:07,
 * a draw re-save knocked it back to `accepting_predictions` at 06:32, and every
 * "live right now" surface went back to reporting nothing on court.
 *
 * Forward-only, which is what `sync-draws` has always done — see the matching
 * transition there. `in_progress` and `completed` are absent deliberately:
 * those are decided by RESULTS, and editing a draw is not new information about
 * whether play has started.
 */
const DRAW_OPENABLE_STATUSES = ['upcoming', 'draw_published']

export async function setTournamentStatus(
  tournamentId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  if (!VALID_STATUSES.includes(status as ValidStatus)) {
    return { ok: false, error: `Invalid status "${status}"` }
  }
  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .update({ status })
    .eq('id', tournamentId)
  if (error) return { ok: false, error: error.message }

  // Status drives what the public pages render (live vs finished), so the
  // cached tournament reads have to be dropped or the change is invisible.
  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')
  return { ok: true }
}

// ── Tournament delete ─────────────────────────────────────────────────────────

export async function deleteTournament(
  tournamentId: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .delete()
    .eq('id', tournamentId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Tournament details update ─────────────────────────────────────────────────

const VALID_SURFACES = ['hard', 'clay', 'grass'] as const

export async function updateTournamentDetails(
  tournamentId: string,
  fields: {
    surface?: string | null
    starts_at?: string | null
    ends_at?: string | null
    draw_close_at?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()

  const update: Record<string, unknown> = {}

  if ('surface' in fields) {
    const s = fields.surface
    if (s && !VALID_SURFACES.includes(s as typeof VALID_SURFACES[number])) {
      return { ok: false, error: `Invalid surface "${s}"` }
    }
    update.surface = s ?? null
  }
  if ('starts_at' in fields) {
    update.starts_at   = fields.starts_at ?? null
    // Keep denormalized starts_year in sync — used by the (external_id, starts_year) unique index
    update.starts_year = fields.starts_at ? new Date(fields.starts_at).getUTCFullYear() : null
  }
  if ('ends_at' in fields)       update.ends_at       = fields.ends_at       ?? null
  if ('draw_close_at' in fields) update.draw_close_at = fields.draw_close_at ?? null

  if (Object.keys(update).length === 0) return { ok: false, error: 'Nothing to update' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .update(update)
    .eq('id', tournamentId)
  if (error) return { ok: false, error: error.message }

  // Name, dates and location are all rendered into the public hub and edition
  // pages — including the <title>, meta description and SportsEvent JSON-LD —
  // so an edit has to invalidate them. Without this the corrected value sat
  // behind the ISR window while search engines kept the stale one.
  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')
  return { ok: true }
}

// ── Manual draw entry ─────────────────────────────────────────────────────────
// Used when the tennis API cannot supply draw data.
// Player externalIds are normalized name slugs ("Carlos Alcaraz" → "carlos-alcaraz").
// For scoring to work, manual results must use the same player name normalization.

const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']

/** Normalize a player name to a stable slug used as their externalId. */
function normalizePlayerId(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics (é→e, ñ→n, ü→u …)
    .replace(/[^a-z0-9\s]/g, '')      // keep letters, digits, spaces
    .trim()
    .replace(/\s+/g, '-')             // spaces → dashes
}

export interface ManualMatch {
  player1Name: string
  player1Seed?: number | null
  player1Country?: string
  player2Name: string
  player2Seed?: number | null
  player2Country?: string
}

/**
 * Save a manually-entered draw for a tournament.
 * Builds the full bracket: named player matches for `firstRound`, then TBD
 * matches for every subsequent round (QF/SF/F etc.) which fill in from picks.
 */
export async function saveManualDraw(
  tournamentId: string,
  externalId: string,
  firstRound: string,
  matches: ManualMatch[],
  openPredictions: boolean,
): Promise<{ ok: boolean; error?: string; matchCount?: number }> {
  await assertAdmin()
  if (!matches.length) return { ok: false, error: 'No matches provided' }

  const startIdx = ROUND_ORDER.indexOf(firstRound)
  if (startIdx === -1) return { ok: false, error: `Unknown round "${firstRound}"` }

  const rounds = ROUND_ORDER.slice(startIdx)
  const allMatches: Record<string, unknown>[] = []

  // First round — named players
  matches.forEach((m, i) => {
    const idx = String(i + 1).padStart(3, '0')
    allMatches.push({
      matchId: `${externalId}-${firstRound}-${idx}`,
      round: firstRound,
      player1: m.player1Name.trim() ? {
        externalId: normalizePlayerId(m.player1Name),
        name:       m.player1Name.trim(),
        country:    (m.player1Country ?? '').trim(),
        ...(m.player1Seed != null ? { seed: m.player1Seed } : {}),
      } : null,
      player2: m.player2Name.trim() ? {
        externalId: normalizePlayerId(m.player2Name),
        name:       m.player2Name.trim(),
        country:    (m.player2Country ?? '').trim(),
        ...(m.player2Seed != null ? { seed: m.player2Seed } : {}),
      } : null,
    })
  })

  // Subsequent rounds — TBD (null players; bracket fills in from picks)
  let prevCount = matches.length
  for (let ri = 1; ri < rounds.length; ri++) {
    const round = rounds[ri]
    const count = Math.ceil(prevCount / 2)
    for (let i = 0; i < count; i++) {
      allMatches.push({
        matchId: `${externalId}-${round}-${String(i + 1).padStart(3, '0')}`,
        round,
        player1: null,
        player2: null,
      })
    }
    prevCount = count
  }

  const draw = { tournamentExternalId: externalId, rounds, matches: allMatches }
  const admin = createAdminClient()

  // See buildDraw: the stored draw is the only record of the ids the qualifier
  // slots carried, and picks reference them. Read it before overwriting.
  const { data: oldDrawRow, error: oldDrawError } = await admin
    .from('draws')
    .select('bracket_data')
    .eq('tournament_id', tournamentId)
    .maybeSingle()
  if (oldDrawError) console.error('[saveManualDraw] failed to read prior draw:', oldDrawError.message)

  const { error: drawError } = await admin
    .from('draws')
    .upsert(
      { tournament_id: tournamentId, bracket_data: draw as unknown, synced_at: new Date().toISOString() },
      { onConflict: 'tournament_id' },
    )
  if (drawError) return { ok: false, error: drawError.message }

  try {
    const summary = await remapResolvedQualifiers(
      admin, tournamentId,
      oldDrawRow?.bracket_data as unknown as DrawLike | null,
      draw as unknown as DrawLike,
      'saveManualDraw',
    )
    if (summary) console.log(`[saveManualDraw] ${summary}`)
  } catch (remapErr) {
    console.error('[saveManualDraw] qualifier remap failed:', remapErr)
  }

  // Bust the ISR cache so tournament detail pages refresh immediately
  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')

  if (openPredictions) {
    // Forward-only: see DRAW_OPENABLE_STATUSES.
    await admin
      .from('tournaments')
      .update({ status: 'accepting_predictions' })
      .eq('id', tournamentId)
      .in('status', DRAW_OPENABLE_STATUSES)

    // Notify + email all users that predictions are now open
    await announceDrawOpen(tournamentId)
  }

  return { ok: true, matchCount: allMatches.length }
}

// ── Manual result entry ───────────────────────────────────────────────────────
// Enter match results by player name. IDs are resolved against the stored draw
// so they are always consistent (whether the draw came from API or manual entry).

export interface ManualResult {
  round: string
  winnerName: string
  loserName: string
  score?: string
}

export async function saveManualResults(
  tournamentId: string,
  externalId: string,
  results: ManualResult[],
  markInProgress: boolean,
): Promise<{ ok: boolean; error?: string; count?: number }> {
  await assertAdmin()
  if (!results.length) return { ok: false, error: 'No results provided' }

  const admin = createAdminClient()

  // Load the stored draw to resolve player names → externalIds
  const { data: drawRow } = await admin
    .from('draws')
    .select('bracket_data')
    .eq('tournament_id', tournamentId)
    .single()

  const draw = drawRow?.bracket_data as Record<string, unknown> | null
  const drawMatches = (draw?.matches as Array<Record<string, unknown>> | undefined) ?? []

  // Build name (lowercased) → externalId map
  const nameToId = new Map<string, string>()
  for (const m of drawMatches) {
    const p1 = m.player1 as Record<string, string> | null
    const p2 = m.player2 as Record<string, string> | null
    if (p1?.name && p1?.externalId) nameToId.set(p1.name.toLowerCase(), p1.externalId)
    if (p2?.name && p2?.externalId) nameToId.set(p2.name.toLowerCase(), p2.externalId)
  }

  // Fall back to normalizing the name if not found in draw (qualifier, lucky loser, etc.)
  const resolveId = (name: string): string =>
    nameToId.get(name.trim().toLowerCase()) ?? normalizePlayerId(name)

  // Group by round to assign unique external_match_ids within the upsert
  const roundCounters: Record<string, number> = {}
  const rows = results.map(r => {
    roundCounters[r.round] = (roundCounters[r.round] ?? 0) + 1
    const seq = String(roundCounters[r.round]).padStart(3, '0')
    return {
      tournament_id:      tournamentId,
      external_match_id:  `${externalId}-${r.round}-result-${seq}`,
      round:              r.round,
      winner_external_id: resolveId(r.winnerName),
      loser_external_id:  resolveId(r.loserName),
      score:              (r.score ?? '').trim(),
      played_at:          new Date().toISOString(),
    }
  })

  const { error } = await admin
    .from('match_results')
    .upsert(rows, { onConflict: 'tournament_id,external_match_id' })
  if (error) return { ok: false, error: error.message }

  if (markInProgress) {
    await admin
      .from('tournaments')
      .update({ status: 'in_progress' })
      .eq('id', tournamentId)
      .eq('status', 'accepting_predictions')
  }

  // Results are entered by hand here (sync-results is idle by design), so this
  // is the main path by which a result reaches the site — and it busted no
  // cache at all. Every other write path in this file revalidates; this one was
  // missed, and a 300-second window on getEdition() was the only reason a
  // freshly entered result showed up at all. `markInProgress` additionally
  // changes what the "on now" lists contain, hence the list tag too.
  revalidateTag('tournament-detail', 'default')
  if (markInProgress) revalidateTag('tournament-list', 'default')

  return { ok: true, count: rows.length }
}

// ── Player management ─────────────────────────────────────────────────────────

export async function createPlayer(data: {
  name: string
  country: string
  tour: 'ATP' | 'WTA'
}): Promise<{ ok: boolean; player?: { id: string; external_id: string; name: string; country: string; tour: string }; error?: string }> {
  await assertAdmin()
  const external_id = normalizePlayerId(data.name)
  if (!external_id) return { ok: false, error: 'Invalid player name' }

  const admin = createAdminClient()
  const { data: player, error } = await admin
    .from('players')
    .upsert(
      { external_id, name: data.name.trim(), country: data.country.trim(), tour: data.tour },
      { onConflict: 'external_id' },
    )
    .select('id, external_id, name, country, tour')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, player: player as { id: string; external_id: string; name: string; country: string; tour: string } }
}

export interface AdminPlayer {
  id: string
  external_id: string
  name: string
  country: string
  tour: string
}

const PLAYERS_PAGE_SIZE = 50

const PLAYER_COLUMNS = 'id, external_id, name, country, tour'

/**
 * Paginated player registry. The table holds thousands of rows, so the list is
 * always a page — never the whole set — and search/filter run in the database.
 */
export async function listPlayers(opts: {
  search?: string
  tour?: 'ATP' | 'WTA'
  page?: number
} = {}): Promise<{ ok: boolean; players: AdminPlayer[]; total: number; page: number; pageSize: number }> {
  await assertAdmin()
  const admin = createAdminClient()

  const page = Math.max(0, opts.page ?? 0)
  const from = page * PLAYERS_PAGE_SIZE

  let q = admin
    .from('players')
    .select(PLAYER_COLUMNS, { count: 'exact' })
    .order('name')
    .range(from, from + PLAYERS_PAGE_SIZE - 1)

  // Strip characters that are syntax in a PostgREST `or` filter, mapping them to
  // wildcards so a query like "Del Potro, J." still matches.
  const term = (opts.search ?? '').trim().replace(/[,()*\\"%]/g, '%')
  if (term) q = q.or(`name.ilike.%${term}%,external_id.ilike.%${term}%`)
  if (opts.tour) q = q.eq('tour', opts.tour)

  const { data, error, count } = await q

  if (error) {
    console.error('listPlayers error:', error.message)
    return { ok: false, players: [], total: 0, page, pageSize: PLAYERS_PAGE_SIZE }
  }

  return {
    ok: true,
    players: (data ?? []) as AdminPlayer[],
    total: count ?? 0,
    page,
    pageSize: PLAYERS_PAGE_SIZE,
  }
}

export async function updatePlayer(
  playerId: string,
  fields: { name: string; country: string; tour: 'ATP' | 'WTA' },
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()

  const name = fields.name.trim()
  if (!name) return { ok: false, error: 'Name cannot be empty' }

  const admin = createAdminClient()
  // external_id is deliberately left alone: draws and match_results reference it
  // as plain text, so renaming it would orphan them.
  const { error } = await admin
    .from('players')
    .update({ name, country: fields.country.trim(), tour: fields.tour })
    .eq('id', playerId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Where a player is referenced — see 056_player_usage.sql. */
export async function getPlayerUsage(
  externalId: string,
): Promise<{ ok: boolean; drawCount: number; resultCount: number }> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin.rpc('player_usage', { p_external_id: externalId })

  if (error) {
    console.error('getPlayerUsage error:', error.message)
    return { ok: false, drawCount: 0, resultCount: 0 }
  }

  const row = (data ?? [])[0] as { draw_count: number; result_count: number } | undefined
  return { ok: true, drawCount: Number(row?.draw_count ?? 0), resultCount: Number(row?.result_count ?? 0) }
}

export async function deletePlayer(playerId: string): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()

  const { error } = await admin.from('players').delete().eq('id', playerId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function searchPlayers(
  query: string,
  tour?: 'ATP' | 'WTA',
): Promise<{ ok: boolean; players: AdminPlayer[] }> {
  await assertAdmin()
  const admin = createAdminClient()
  let q = admin
    .from('players')
    .select(PLAYER_COLUMNS)
    .ilike('name', `%${query}%`)
    .order('name')
    .limit(20)

  if (tour) q = q.eq('tour', tour)

  const { data, error } = await q
  if (error) {
    console.error('searchPlayers error:', error.message)
    return { ok: false, players: [] }
  }
  return { ok: true, players: (data ?? []) as AdminPlayer[] }
}

// ── Manual tournament creation ────────────────────────────────────────────────

export interface AdminSeriesOption {
  id: string
  slug: string
  name: string
  /** Years already taken, so the form can warn before the unique index does. */
  years: number[]
}

/**
 * Series for the create-tournament picker, newest activity first.
 *
 * Every new tournament is an EDITION of some series — that is what gives it a
 * URL. Picking an existing series is the common path from the second season
 * onward; only a genuinely new event mints a slug.
 */
export async function listTournamentSeries(): Promise<AdminSeriesOption[]> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('tournament_series')
    .select('id, slug, name, tournaments(starts_year)')
    .order('name', { ascending: true })
    .limit(500)

  if (error) {
    console.error('[admin] listTournamentSeries failed:', error.message)
    return []
  }

  return ((data ?? []) as {
    id: string
    slug: string
    name: string
    tournaments?: { starts_year: number | null }[] | null
  }[]).map(row => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    years: [...new Set((row.tournaments ?? []).map(t => t.starts_year).filter((y): y is number => y != null))]
      .sort((a, b) => b - a),
  }))
}

// ── Series SEO editing ────────────────────────────────────────────────────────
//
// A series carries the public naming for every edition under it: `name` is the
// H1, the breadcrumb and the SportsEvent JSON-LD, `short_name` is the <title>.
// Which of the two candidate names is the searched one is a per-series call and
// not a rule — "Bucharest Open" beats "Romanian Open", "Umag" beats "Croatia
// Open Umag", but no Grand Slam wants its city. That judgement can only be made
// (and revised) by a human looking at search behaviour, so it needs a form.

export interface AdminSeriesRow {
  id: string
  slug: string
  name: string
  short_name: string | null
  city: string | null
  country: string | null
  flag_emoji: string | null
  surface: 'hard' | 'clay' | 'grass' | null
  category: 'grand_slam' | 'masters_1000' | '500' | '250' | null
  slug_reviewed: boolean
  /** Editions attached, newest first — drives the "what this affects" count. */
  years: number[]
}

const ADMIN_SERIES_FIELDS =
  'id, slug, name, short_name, city, country, flag_emoji, surface, category, slug_reviewed, tournaments(starts_year)'

type RawAdminSeries = Omit<AdminSeriesRow, 'years'> & {
  tournaments?: { starts_year: number | null }[] | null
}

function toAdminSeries(row: RawAdminSeries): AdminSeriesRow {
  const { tournaments, ...series } = row
  return {
    ...series,
    years: [...new Set((tournaments ?? []).map(t => t.starts_year).filter((y): y is number => y != null))]
      .sort((a, b) => b - a),
  }
}

/** Every series, for the SEO naming list. Unreviewed first — those are noindex. */
export async function listSeriesForAdmin(): Promise<AdminSeriesRow[]> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('tournament_series')
    .select(ADMIN_SERIES_FIELDS)
    .order('name', { ascending: true })
    .limit(500)

  if (error) {
    console.error('[admin] listSeriesForAdmin failed:', error.message)
    return []
  }

  const rows = (data ?? []) as RawAdminSeries[]
  // Unreviewed series are noindex and absent from the sitemap, so they are the
  // ones actually costing traffic. Surface them before the settled ones.
  return rows
    .map(toAdminSeries)
    .sort((a, b) => Number(a.slug_reviewed) - Number(b.slug_reviewed) || a.name.localeCompare(b.name))
}

export async function getSeriesForAdmin(id: string): Promise<AdminSeriesRow | null> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('tournament_series')
    .select(ADMIN_SERIES_FIELDS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[admin] getSeriesForAdmin failed:', error.message)
    return null
  }
  return data ? toAdminSeries(data as RawAdminSeries) : null
}

export interface SeriesSeoUpdate {
  name: string
  shortName: string
  city: string
  country: string
  surface: 'hard' | 'clay' | 'grass' | null
  category: 'grand_slam' | 'masters_1000' | '500' | '250' | null
  slug?: string
  slugReviewed: boolean
  /**
   * Explicit acknowledgement that a PUBLISHED URL is being moved.
   *
   * Required rather than inferred: the whole point of the lock is that no
   * routine save can move a live URL by accident, so the override has to be a
   * separate deliberate act the admin performed in the UI.
   */
  confirmSlugChange?: boolean
}

const VALID_CATEGORIES = ['grand_slam', 'masters_1000', '500', '250'] as const

/**
 * Rename a series, and move its URL when that is genuinely safe.
 *
 * The slug rule is the reason this is one action rather than two:
 *
 *   - `slug_reviewed = false` — the page is noindex and out of the sitemap, so
 *     nothing outside this database has ever seen the URL. Freely editable;
 *     this is the window in which the sync cron's machine-guessed slugs get
 *     corrected.
 *   - `slug_reviewed = true` — published. Locked by default, because moving it
 *     hands back whatever ranking the URL has accumulated and 404s every
 *     external link to it.
 *
 * The lock is a guard rail rather than a wall, because "published" is not the
 * same as "indexed": a URL published last week may not be in any index yet, and
 * only a human looking at Search Console can tell. So an explicit
 * `confirmSlugChange` overrides it.
 *
 * What that override does NOT break is worth stating, since it is the reason
 * this is defensible at all: every in-app link — notifications, emails, the
 * activity feed — addresses tournaments by UUID (`/tournaments/<id>`), and
 * `legacy-redirect.ts` resolves that to the CURRENT slug per request. Internal
 * navigation therefore follows a rename automatically. The exposure is limited
 * to external references: search results, shared links, bookmarks.
 */
export async function updateSeriesSeo(
  seriesId: string,
  data: SeriesSeoUpdate,
): Promise<{ ok: boolean; error?: string; slug?: string }> {
  await assertAdmin()
  const admin = createAdminClient()

  const name = data.name.trim()
  if (!name) return { ok: false, error: 'Display name cannot be empty.' }

  const { data: currentRow, error: readError } = await admin
    .from('tournament_series')
    .select('slug, slug_reviewed, flag_emoji')
    .eq('id', seriesId)
    .maybeSingle()

  if (readError) return { ok: false, error: readError.message }
  if (!currentRow) return { ok: false, error: 'That series no longer exists.' }
  const current = currentRow as { slug: string; slug_reviewed: boolean; flag_emoji: string | null }

  if (data.category && !VALID_CATEGORIES.includes(data.category)) {
    return { ok: false, error: `Invalid category "${data.category}"` }
  }
  if (data.surface && !VALID_SURFACES.includes(data.surface)) {
    return { ok: false, error: `Invalid surface "${data.surface}"` }
  }

  const country = data.country.trim()

  // Clearing the country clears the flag; otherwise the flag is only REPLACED
  // when the name actually resolves to one. A failed lookup keeps what is
  // already stored rather than nulling it — `country` was populated by
  // splitting `tournaments.location` in migration 073 and is not guaranteed to
  // match the COUNTRIES list forever, and silently dropping a flag while
  // saving an unrelated rename is the kind of loss nobody goes looking for.
  // Tournament references carry the flag everywhere, so it is not cosmetic.
  const flag = !country ? null : flagForCountry(country) ?? current.flag_emoji

  const update: Record<string, unknown> = {
    name,
    // Empty means "no compact form" — fall back to the full name in <title>
    // rather than storing '', which seriesLabel would happily render as blank.
    short_name: data.shortName.trim() || null,
    city: data.city.trim() || null,
    country: country || null,
    flag_emoji: flag,
    surface: data.surface,
    category: data.category,
    slug_reviewed: data.slugReviewed,
  }

  // Re-checked against the DATABASE's current state, not against a flag the
  // client sent: a stale form open since before the series was published must
  // not be able to move a live URL.
  const wantsSlugChange = data.slug !== undefined && data.slug.trim() !== current.slug
  if (wantsSlugChange && current.slug_reviewed && !data.confirmSlugChange) {
    return {
      ok: false,
      error:
        'This URL is published. Unlock it first if you are sure it is not indexed yet — ' +
        'moving an indexed URL 404s every external link to it.',
    }
  }

  let nextSlug = current.slug
  if (wantsSlugChange) {
    const slug = data.slug!.trim()
    const problem = slugErrorMessage(slug)
    if (problem) return { ok: false, error: `URL slug: ${problem}` }
    update.slug = slug
    nextSlug = slug
  }

  const { error } = await admin.from('tournament_series').update(update).eq('id', seriesId)

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `The URL slug "${nextSlug}" is already taken. Pick another.` }
    }
    return { ok: false, error: error.message }
  }

  // Leave a forwarding address. The warning above is only a warning — an admin
  // who unlocks a published slug and renames it anyway used to strand every
  // indexed URL under it, which is exactly what happened to `japan-open`.
  //
  // Written after the rename succeeds, so a failed update never leaves a
  // tombstone for a slug that is still live.
  if (wantsSlugChange) {
    const { error: historyError } = await admin
      .from('tournament_series_slug_history')
      .upsert({ slug: current.slug, series_id: seriesId }, { onConflict: 'slug' })
    // Logged rather than surfaced: the rename itself worked, and failing the
    // whole action here would tell the admin their edit was rejected when it
    // was not. The cost is one URL that 404s instead of redirecting.
    if (historyError) console.error('[series] slug history write failed:', historyError.message)

    // Renaming BACK to a previously retired slug: drop that tombstone, or the
    // now-live URL would redirect to itself.
    const { error: cleanupError } = await admin
      .from('tournament_series_slug_history')
      .delete()
      .eq('slug', nextSlug)
    if (cleanupError) console.error('[series] slug history cleanup failed:', cleanupError.message)
  }

  // These fields are the <title>, H1, meta description and JSON-LD of the hub
  // and of every edition under it. Without busting the tag the corrected name
  // sits behind the 5-minute ISR window while crawlers keep the old one.
  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')
  return { ok: true, slug: nextSlug }
}

/**
 * How the new tournament attaches to a series.
 *
 * `existing` is the common case from the second season on. `new` mints a slug,
 * which is permanent — there is deliberately no way to change it later, since
 * a moved URL discards every backlink pointing at it.
 */
export type SeriesSelection =
  | { mode: 'existing'; seriesId: string }
  | { mode: 'new'; slug: string; name: string; shortName?: string }

export async function createTournament(data: {
  name: string
  tour: 'ATP' | 'WTA'
  category: 'grand_slam' | 'masters_1000' | '500' | '250'
  country: string
  city: string
  surface: 'hard' | 'clay' | 'grass'
  startsAt: string
  drawSize: 32 | 64 | 128
  series: SeriesSelection
}): Promise<{ ok: boolean; tournamentId?: string; slugUrl?: string; error?: string }> {
  await assertAdmin()

  const external_id = normalizePlayerId(data.name)
  if (!external_id) return { ok: false, error: 'Invalid tournament name' }

  const startsAt = new Date(data.startsAt)
  const starts_year = startsAt.getUTCFullYear()
  // Default ends_at to 7 days after start (14 for grand slams)
  const durationDays = data.category === 'grand_slam' ? 14 : 7
  const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000)

  const admin = createAdminClient()
  const flag = flagForCountry(data.country)
  const location = `${data.city.trim()}, ${data.country.trim()}`

  // ── Resolve the series first ───────────────────────────────────────────────
  // Done before the tournament insert so a rejected slug fails cleanly rather
  // than leaving an orphan tournament with no URL.
  let seriesId: string
  let seriesSlug: string

  if (data.series.mode === 'existing') {
    const { data: existing, error: lookupError } = await admin
      .from('tournament_series')
      .select('id, slug')
      .eq('id', data.series.seriesId)
      .maybeSingle()

    if (lookupError) return { ok: false, error: lookupError.message }
    if (!existing) return { ok: false, error: 'That series no longer exists.' }
    seriesId = (existing as { id: string }).id
    seriesSlug = (existing as { slug: string }).slug
  } else {
    const slug = data.series.slug.trim()
    // Mirrors the CHECK constraints in 072 so the failure is a readable message
    // rather than a Postgres constraint name.
    const problem = slugErrorMessage(slug)
    if (problem) return { ok: false, error: `URL slug: ${problem}` }

    const seriesName = data.series.name.trim() || data.name.trim()

    const { data: created, error: seriesError } = await admin
      .from('tournament_series')
      .insert({
        slug,
        name: seriesName,
        short_name: data.series.shortName?.trim() || seriesName,
        city: data.city.trim() || null,
        country: data.country.trim() || null,
        flag_emoji: flag,
        surface: data.surface,
        category: data.category,
        // A human typed this slug on the form, so it is reviewed by definition.
        slug_reviewed: true,
      })
      .select('id, slug')
      .single()

    if (seriesError) {
      if (seriesError.code === '23505') {
        return { ok: false, error: `The URL slug "${slug}" is already taken. Pick another.` }
      }
      return { ok: false, error: seriesError.message }
    }
    seriesId = (created as { id: string }).id
    seriesSlug = (created as { slug: string }).slug
  }

  const { data: tournament, error } = await admin
    .from('tournaments')
    .insert({
      external_id,
      name: data.name.trim(),
      tour: data.tour,
      category: data.category,
      surface: data.surface,
      location,
      flag_emoji: flag,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      starts_year,
      draw_size: data.drawSize,
      is_manual: true,
      status: 'upcoming',
      series_id: seriesId,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      // Two different unique indexes can land here, and they mean different
      // things to whoever is filling in the form.
      const isSeriesYearTour = error.message.includes('tournaments_series_year_tour_key')
      return {
        ok: false,
        error: isSeriesYearTour
          ? `A ${data.tour} edition of that series already exists for ${starts_year} — /tournaments/${seriesSlug}/${starts_year} is taken.`
          : `A tournament with external_id "${external_id}" already exists for ${starts_year}. Try a different name.`,
      }
    }
    return { ok: false, error: error.message }
  }

  // The new edition changes both the hub and the tournament list.
  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')

  return {
    ok: true,
    tournamentId: tournament.id,
    slugUrl: `/tournaments/${seriesSlug}/${starts_year}`,
  }
}

export interface AdminTournament {
  id: string; name: string; tour: string; category: string; status: string
  starts_at: string | null; ends_at: string | null; surface: string | null
  location: string | null; flag_emoji: string | null
  has_draw: boolean
}

const TOURNAMENT_COLUMNS = 'id, name, tour, category, status, starts_at, ends_at, surface, location, flag_emoji'

/** Completed tournaments that ended more than this long ago move to the "Past" tab. */
const PAST_TOURNAMENT_CUTOFF_DAYS = 7
const PAST_TOURNAMENTS_PAGE_SIZE  = 50

function pastCutoffISO(): string {
  return new Date(Date.now() - PAST_TOURNAMENT_CUTOFF_DAYS * 86_400_000).toISOString()
}

/** Attach `has_draw` to tournament rows with a single lookup query. */
async function withDrawFlags(
  admin: ReturnType<typeof createAdminClient>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[],
): Promise<AdminTournament[]> {
  if (rows.length === 0) return []

  const { data: draws, error } = await admin
    .from('draws')
    .select('tournament_id')
    .in('tournament_id', rows.map(r => r.id))

  if (error) console.error('withDrawFlags error:', error.message)
  const drawSet = new Set((draws ?? []).map((d: { tournament_id: string }) => d.tournament_id))

  return rows.map(t => ({
    id: t.id,
    name: t.name,
    tour: t.tour,
    category: t.category,
    status: t.status,
    starts_at: t.starts_at,
    ends_at: t.ends_at ?? null,
    surface: t.surface,
    location: t.location ?? null,
    flag_emoji: t.flag_emoji ?? null,
    has_draw: drawSet.has(t.id),
  }))
}

/**
 * Current tournaments: everything admin-created except those completed over a week ago.
 * Sorted oldest first so in-progress tournaments (which started before anything upcoming)
 * sit at the top, where results get entered.
 */
export async function getManualTournaments(): Promise<{ ok: boolean; tournaments: AdminTournament[] }> {
  await assertAdmin()
  const admin = createAdminClient()

  // NOT (completed AND ended long ago) → not completed OR ended recently.
  // `ends_at is null` is kept here so a row without an end date stays visible
  // rather than falling through the gap between the two tabs.
  const { data: tournaments, error } = await admin
    .from('tournaments')
    .select(TOURNAMENT_COLUMNS)
    .eq('is_manual', true)
    .or(`status.neq.completed,ends_at.gte.${pastCutoffISO()},ends_at.is.null`)
    .order('starts_at', { ascending: true, nullsFirst: false })
    .limit(100)

  if (error) {
    console.error('getManualTournaments error:', error.message)
    return { ok: false, tournaments: [] }
  }

  return { ok: true, tournaments: await withDrawFlags(admin, tournaments ?? []) }
}

/**
 * Archive tab: tournaments completed more than a week ago, most recent first.
 * Loaded on demand only — never part of the initial admin page payload.
 */
export async function getPastTournaments(search?: string): Promise<{
  ok: boolean; tournaments: AdminTournament[]; hasMore: boolean
}> {
  await assertAdmin()
  const admin = createAdminClient()

  let query = admin
    .from('tournaments')
    .select(TOURNAMENT_COLUMNS)
    .eq('is_manual', true)
    .eq('status', 'completed')
    .lt('ends_at', pastCutoffISO())

  // Characters that are syntax in a PostgREST `or` filter become wildcards rather
  // than being dropped: an unescaped comma would split the term into two bogus
  // conditions, but deleting it makes "Madrid, Spain" fail to match "Madrid, Spain".
  const term = (search ?? '').trim().replace(/[,()*\\"%]/g, '%')
  if (term) query = query.or(`name.ilike.%${term}%,location.ilike.%${term}%`)

  // Fetch one extra row to detect whether more exist beyond the page.
  const { data: tournaments, error } = await query
    .order('ends_at', { ascending: false })
    .limit(PAST_TOURNAMENTS_PAGE_SIZE + 1)

  if (error) {
    console.error('getPastTournaments error:', error.message)
    return { ok: false, tournaments: [], hasMore: false }
  }

  const rows    = tournaments ?? []
  const hasMore = rows.length > PAST_TOURNAMENTS_PAGE_SIZE

  return {
    ok: true,
    tournaments: await withDrawFlags(admin, rows.slice(0, PAST_TOURNAMENTS_PAGE_SIZE)),
    hasMore,
  }
}

// ── Scoring status (for Award Points section in admin panel) ─────────────────

/** Award Points is a work queue — cap it so the page payload stays flat as seasons accumulate. */
const SCORING_STATUS_LIMIT = 30

export interface ScoringTournament {
  id: string
  name: string
  status: string
  location: string | null
  flag_emoji: string | null
  totalResults: number       // played, non-BYE match results
  correctPicks: number       // correct, non-locked picks across all predictions
  unscoredPicks: number      // correct picks that should have a ledger row and don't  ← pending work
  driftPredictions: number   // predictions whose stored total disagrees with the ledger
}

export async function getScoringStatus(): Promise<ScoringTournament[]> {
  await assertAdmin()
  const admin = createAdminClient()

  // Bounded: the tab is a work queue, not an archive. Older tournaments stay
  // reachable through the Past Tournaments tab.
  const { data: tournaments, error: tErr } = await admin
    .from('tournaments')
    .select('id, name, status, location, flag_emoji')
    .in('status', ['in_progress', 'completed'])
    .order('starts_at', { ascending: false })
    .limit(SCORING_STATUS_LIMIT)

  if (tErr) {
    console.error('getScoringStatus tournaments error:', tErr.message)
    return []
  }
  if (!tournaments?.length) return []

  // Aggregated in Postgres — see 054_scoring_status_pending_work.sql, narrowed by
  // 101_scoring_status_unpaid_rounds.sql. This asserts the award-points cron's
  // invariants, the same ones scripts/verify-scoring.mjs checks; both counts at
  // zero means nothing is left to award.
  //
  // p_unpaid_rounds is what keeps the second invariant honest. The cron skips a
  // result whose round pays nothing, so correct picks there never get a ledger
  // row and must not read as pending — see unpaidRounds(). Passing it from here
  // means POINTS_TABLE stays the single source of truth; the SQL keeps no copy.
  const { data: counts, error: cErr } = await admin.rpc('scoring_status', {
    p_tournament_ids: tournaments.map(t => t.id),
    p_unpaid_rounds:  unpaidRounds(),
  })

  if (cErr) {
    console.error('getScoringStatus rpc error:', cErr.message)
    return []
  }

  type ScoringCount = {
    tournament_id: string
    total_results: number
    correct_picks: number
    unscored_picks: number
    drift_predictions: number
  }
  const byId = new Map<string, ScoringCount>(
    ((counts ?? []) as ScoringCount[]).map(c => [c.tournament_id, c]),
  )

  return tournaments.map(t => {
    const c = byId.get(t.id)
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      location: t.location ?? null,
      flag_emoji: t.flag_emoji ?? null,
      totalResults:     Number(c?.total_results     ?? 0),
      correctPicks:     Number(c?.correct_picks     ?? 0),
      unscoredPicks:    Number(c?.unscored_picks    ?? 0),
      driftPredictions: Number(c?.drift_predictions ?? 0),
    }
  })
}

// ── Re-run tournament points ──────────────────────────────────────────────────
// Erases every awarded point for one tournament, then re-triggers the
// award-points cron so the (now unscored) results are scored from scratch.
// Used to recover from a mis-entered winner or stale qualifier picks.
//
// Why this works: the cron is convergent — it scores any (match_result,
// prediction) pair missing from point_ledger and recomputes points_earned as
// SUM(ledger). Deleting the tournament's ledger rows makes all its pairs
// unscored again; one cron run rebuilds them from current results/picks.
//
// Erase phase:
//   1. point_ledger rows for the tournament
//   2. predictions.points_earned → 0 (global + challenge predictions)
//   3. tournament-scoped user_achievements (cron re-awards, incl. trophies)
//   4. finalized challenges → back to scoreable status (accepted / active)
//   5. targeted ranking + league recalcs for every previously-affected user.
//      The cron only recalcs users who GAIN points this run — a user whose
//      points drop to zero after a winner correction would otherwise keep
//      stale ranking_points / league totals.
//
// The re-run is SILENT (?silent=1): no points notifications, no emails, no
// achievement notifications. Existing notifications are left untouched — this
// is a repair tool, not a re-announcement.
//
// ⚠️ REPRICING TRAP, for ATP 250 and 500 events played before 2026-08-24.
// The '250' and '500' rows of POINTS_TABLE were realigned to the real ATP
// figures on that date (a 250 semifinal went from 45 to 100, roughly a
// doubling across the board), and the decision was to apply that FORWARD ONLY —
// the 2,807 ledger rows already written at the old rates were deliberately left
// alone rather than reprice 8% of every point ever awarded.
//
// This tool does not know that. It scores from scratch against the CURRENT
// table, so re-running an old 250/500 to fix one mis-entered result would also
// silently double that tournament's points for everyone in it and move the
// leaderboard. Slams and Masters are unaffected — their tables never changed.
//
// Before re-running a pre-2026-08-24 250 or 500: either accept the repricing
// (it is at least consistent with what the FAQ now publishes), or fix the
// result some other way. There is no per-tournament rate history to fall back
// on.

/**
 * Refuse a repair while an award-points run is in flight — mutating mid-run
 * lets the cron write rows computed from pre-repair state. Same 10-minute
 * staleness window as the withCronLogging guard.
 *
 * Returns an error message when the job is running, null when it is safe.
 */
async function awardPointsInFlight(admin: SupabaseClient): Promise<string | null> {
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data, error } = await admin
    .from('cron_runs')
    .select('id')
    .eq('job_name', 'award-points')
    .eq('status', 'running')
    .gte('started_at', staleThreshold)
    .limit(1)
  if (error) return error.message
  return data && data.length > 0
    ? 'award-points is currently running — try again in a minute.'
    : null
}

export interface RerunSummary {
  ledgerRowsDeleted: number
  predictionsReset: number
  usersRecalculated: number
  challengesReopened: number
}

export async function rerunTournamentPoints(
  tournamentId: string,
): Promise<{ ok: boolean; error?: string; erased?: RerunSummary; rerun?: unknown }> {
  await assertAdmin()
  const admin = createAdminClient()

  const busy = await awardPointsInFlight(admin)
  if (busy) return { ok: false, error: busy }

  // ── 1. Snapshot affected users BEFORE the wipe (paginated) ────────────────
  // Only global predictions (challenge_id IS NULL) drive rankings/leagues.
  const affectedUsers = new Set<string>()
  {
    const PAGE = 1000
    let from = 0
    while (true) {
      const { data: page, error } = await admin
        .from('predictions')
        .select('user_id, challenge_id')
        .eq('tournament_id', tournamentId)
        .range(from, from + PAGE - 1)
      if (error) return { ok: false, error: `predictions read: ${error.message}` }
      if (!page?.length) break
      for (const p of page) {
        if (!p.challenge_id) affectedUsers.add(p.user_id)
      }
      if (page.length < PAGE) break
      from += PAGE
    }
  }

  // ── 2. Delete the ledger — every (result, prediction) pair becomes unscored ──
  const { count: ledgerCount, error: countErr } = await admin
    .from('point_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
  if (countErr) return { ok: false, error: `ledger count: ${countErr.message}` }

  const { error: ledgerErr } = await admin
    .from('point_ledger')
    .delete()
    .eq('tournament_id', tournamentId)
  if (ledgerErr) return { ok: false, error: `ledger delete: ${ledgerErr.message}` }

  // ── 3. Reset prediction totals ─────────────────────────────────────────────
  const { data: resetRows, error: resetErr } = await admin
    .from('predictions')
    .update({ points_earned: 0 })
    .eq('tournament_id', tournamentId)
    .gt('points_earned', 0)
    .select('id')
  if (resetErr) return { ok: false, error: `predictions reset: ${resetErr.message}` }

  // ── 4. Remove tournament-scoped achievements (trophies) — cron re-awards ──
  // Global milestones (tournament_id IS NULL) are one-way and stay untouched.
  const { error: achErr } = await admin
    .from('user_achievements')
    .delete()
    .eq('tournament_id', tournamentId)
  if (achErr) return { ok: false, error: `achievements delete: ${achErr.message}` }

  // ── 5. Reopen finalized challenges so the cron re-scores them ─────────────
  // Friends: cron finalizes status='accepted'; anonymous: cron scores status='active'.
  const { data: friendsReopened, error: friendsErr } = await admin
    .from('challenges')
    .update({
      status: 'accepted',
      winner_id: null,
      challenger_points: 0,
      challenged_points: 0,
      challenger_predictions_count: 0,
      challenged_predictions_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .eq('is_anonymous', false)
    .select('id')
  if (friendsErr) return { ok: false, error: `friends challenges reopen: ${friendsErr.message}` }

  const { data: anonReopened, error: anonErr } = await admin
    .from('challenges')
    .update({
      status: 'active',
      challenger_points: 0,
      challenged_points: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .eq('is_anonymous', true)
    .select('id')
  if (anonErr) return { ok: false, error: `anonymous challenges reopen: ${anonErr.message}` }

  // ── 6. Targeted ranking recalc for every previously-affected user ─────────
  // One set-based call (084) rather than one RPC per user — same reason as
  // the award-points cron, and this path can affect far more users at once
  // than a nightly scoring run does.
  const userIds = Array.from(affectedUsers)
  for (let i = 0; i < userIds.length; i += 1000) {
    const { error: rankErr } = await admin.rpc('recalculate_ranking_points_bulk', {
      p_user_ids: userIds.slice(i, i + 1000),
    })
    // Returned, not logged: this runs inside an admin repair flow whose whole
    // purpose is to leave rankings correct. Reporting success on a failed
    // recalculation would be worse than the fault it was invoked to fix.
    if (rankErr) return { ok: false, error: `ranking recalculation: ${rankErr.message}` }
  }

  // ── 7. Targeted league recalc for those users' memberships ────────────────
  // Chunk the .in() filter to keep each query bounded.
  const memberships: Array<{ league_id: string; user_id: string }> = []
  for (let i = 0; i < userIds.length; i += 200) {
    const { data: page, error } = await admin
      .from('league_members')
      .select('league_id, user_id')
      .in('user_id', userIds.slice(i, i + 200))
    if (error) return { ok: false, error: `league memberships read: ${error.message}` }
    memberships.push(...(page ?? []))
  }
  for (let i = 0; i < memberships.length; i += 50) {
    await Promise.all(
      memberships.slice(i, i + 50).map(m =>
        admin.rpc('recalculate_member_points', { p_league_id: m.league_id, p_user_id: m.user_id })
      )
    )
  }

  const erased: RerunSummary = {
    ledgerRowsDeleted: ledgerCount ?? 0,
    predictionsReset: resetRows?.length ?? 0,
    usersRecalculated: userIds.length,
    challengesReopened: (friendsReopened?.length ?? 0) + (anonReopened?.length ?? 0),
  }

  // ── 7b. Drop the recap so the re-run rebuilds it ──────────────────────────
  // The recap was computed from the ledger this function just deleted, so its
  // podium and points figures now describe scoring that no longer exists.
  // Deleting it is also what schedules the rebuild: the cron's step 14 builds
  // recaps for completed tournaments that have none, and step 8 below is a cron
  // run — so the corrected recap lands in the same pass as the corrected points.
  await deleteRecap(tournamentId, admin)
  revalidateTag('tournament-recaps', 'default')

  // ── 8. Re-score everything via the existing cron — silent (no notifications) ──
  const { ok, data } = await triggerCron('award-points', { silent: '1' })
  return { ok, erased, rerun: data, ...(ok ? {} : { error: 'Erase succeeded but award-points re-run failed — run it manually from this tab.' }) }
}

// ── Rebuild a tournament recap on demand ──────────────────────────────────────
// The cron builds a recap once and never revisits it, which is right: the
// numbers only change when the results do. When they DO change — a mis-entered
// score corrected weeks later — nothing else would notice, because the recap
// row still exists and step 14 only fills in missing ones. This is the manual
// override for that case, and for previewing a recap before the next cron run.
export async function rebuildTournamentRecap(
  tournamentId: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()

  const result = await buildAndStoreRecap(tournamentId, admin)
  if (!result.ok) return result

  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-recaps', 'default')
  return { ok: true }
}

// ── Revert a premature "completed" ────────────────────────────────────────────
// Marking a tournament completed is a trigger, not a label. The award-points
// cron reads the status as the finish line and, in the same run:
//   - awards top-3 trophies and Perfect Prediction,
//   - finalizes friends challenges (writing winner_id),
//   - finalizes anonymous challenges,
//   - expires every still-pending challenge invite for the tournament.
// Flipping the status back on its own leaves all of that behind — a champion
// crowned before the final was played.
//
// What this does NOT touch: point_ledger, predictions.points_earned, rankings,
// leagues. Those matches really were played and their points are correct; only
// the "the tournament is over" consequences are undone. Use
// rerunTournamentPoints for a mis-entered result.
//
// Silent by design: the achievement notifications go with the badges, so a user
// who has not opened the app since sees nothing at all. Emails already sent
// cannot be recalled — that is the one visible trace.
export interface RevertCompletionSummary {
  newStatus: string
  achievementsRemoved: number
  notificationsRemoved: number
  challengesReopened: number
  challengeInvitesRestored: number
}

export async function revertTournamentCompletion(
  tournamentId: string,
  newStatus: 'in_progress' | 'accepting_predictions' = 'in_progress',
): Promise<{ ok: boolean; error?: string; summary?: RevertCompletionSummary }> {
  await assertAdmin()
  const admin = createAdminClient()

  if (newStatus !== 'in_progress' && newStatus !== 'accepting_predictions') {
    return { ok: false, error: `Invalid target status "${newStatus}"` }
  }

  const busy = await awardPointsInFlight(admin)
  if (busy) return { ok: false, error: busy }

  const { data: tournament, error: tErr } = await admin
    .from('tournaments')
    .select('id, status')
    .eq('id', tournamentId)
    .single()
  if (tErr || !tournament) return { ok: false, error: tErr?.message ?? 'Tournament not found' }
  if (tournament.status !== 'completed') {
    return { ok: false, error: `Tournament is "${tournament.status}", not completed — nothing to revert.` }
  }

  // ── 1. Flip the status FIRST ──────────────────────────────────────────────
  // Order matters: a cron run starting mid-repair would re-award every trophy
  // we are about to delete. Removing the trigger before the consequences means
  // the worst case is a half-cleaned state we can safely re-run, never a
  // silently re-awarded badge.
  const { error: statusErr } = await admin
    .from('tournaments')
    .update({ status: newStatus })
    .eq('id', tournamentId)
    .eq('status', 'completed')
  if (statusErr) return { ok: false, error: `status update: ${statusErr.message}` }

  // ── 2. Delete tournament-scoped achievements ──────────────────────────────
  // Trophies + Perfect Prediction both carry tournament_id, so this is the
  // complete set of badges the premature completion produced. Global milestones
  // (tournament_id IS NULL) are one-way and stay untouched.
  // The returned rows are what lets us find the matching notifications.
  const { data: removedAchievements, error: achErr } = await admin
    .from('user_achievements')
    .delete()
    .eq('tournament_id', tournamentId)
    .select('user_id, achievement_key, earned_at')
  if (achErr) return { ok: false, error: `achievements delete: ${achErr.message}` }

  // ── 3. Delete the badge notifications they generated ──────────────────────
  // notifyAchievements writes no tournament_id — only meta.achievement_key — so
  // the achievement's earned_at is the only thing separating this award from the
  // same (repeatable) trophy won at another event. A ±10 minute window around it
  // is wide enough for the notification insert and far narrower than any two
  // tournaments completing.
  let notificationsRemoved = 0
  const awards = removedAchievements ?? []
  for (let i = 0; i < awards.length; i += 25) {
    const batch = await Promise.all(
      awards.slice(i, i + 25).map(a => {
        const earned = new Date(a.earned_at).getTime()
        return admin
          .from('notifications')
          .delete()
          .eq('user_id', a.user_id)
          .eq('type', 'achievement_earned')
          .eq('meta->>achievement_key', a.achievement_key)
          .gte('created_at', new Date(earned - 10 * 60 * 1000).toISOString())
          .lte('created_at', new Date(earned + 10 * 60 * 1000).toISOString())
          .select('id')
      }),
    )
    for (const { data, error } of batch) {
      if (error) return { ok: false, error: `notifications delete: ${error.message}` }
      notificationsRemoved += data?.length ?? 0
    }
  }

  // ── 4. Reopen the challenges the completion finalized ─────────────────────
  // Points stay: they are recomputed from the (untouched) predictions on every
  // run and are correct as of now. Only the verdict is withdrawn.
  const { data: friendsReopened, error: friendsErr } = await admin
    .from('challenges')
    .update({ status: 'accepted', winner_id: null, updated_at: new Date().toISOString() })
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .eq('is_anonymous', false)
    .select('id')
  if (friendsErr) return { ok: false, error: `friends challenges reopen: ${friendsErr.message}` }

  const { data: anonReopened, error: anonErr } = await admin
    .from('challenges')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('tournament_id', tournamentId)
    .eq('status', 'completed')
    .eq('is_anonymous', true)
    .select('id')
  if (anonErr) return { ok: false, error: `anonymous challenges reopen: ${anonErr.message}` }

  // ── 5. Un-expire the invites the completion killed ────────────────────────
  // Both paths that write 'expired' (this cron and respondToChallenge) fire only
  // because the tournament was completed, so for this tournament every expired
  // row is collateral from the mistake.
  const { data: unexpired, error: expErr } = await admin
    .from('challenges')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('tournament_id', tournamentId)
    .eq('status', 'expired')
    .select('id')
  if (expErr) return { ok: false, error: `challenge invites restore: ${expErr.message}` }

  // ── 6. Drop the recap ─────────────────────────────────────────────────────
  // It names a champion, a podium and a "biggest bust" — every one of which is
  // a claim that the tournament is over. Leaving it behind would keep making
  // that claim on the homepage after the admin decided it was not. The cron
  // rebuilds it if and when the tournament completes for real.
  await deleteRecap(tournamentId, admin)

  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')
  revalidateTag('tournament-recaps', 'default')

  return {
    ok: true,
    summary: {
      newStatus,
      achievementsRemoved: awards.length,
      notificationsRemoved,
      challengesReopened: (friendsReopened?.length ?? 0) + (anonReopened?.length ?? 0),
      challengeInvitesRestored: unexpired?.length ?? 0,
    },
  }
}

export async function getTournament(tournamentId: string): Promise<{
  ok: boolean
  tournament?: {
    id: string; name: string; tour: string; category: string
    country: string; city: string; surface: string | null
    starts_at: string | null; draw_size: number | null; status: string
  }
  error?: string
}> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data: tournament, error } = await admin
    .from('tournaments')
    .select('id, name, tour, category, location, surface, starts_at, draw_size, status')
    .eq('id', tournamentId)
    .single()

  if (error || !tournament) return { ok: false, error: error?.message ?? 'Tournament not found' }

  // Parse "City, Country" from location field
  const location = (tournament.location as string) ?? ''
  const commaIdx = location.indexOf(',')
  const city = commaIdx >= 0 ? location.slice(0, commaIdx).trim() : ''
  const country = commaIdx >= 0 ? location.slice(commaIdx + 1).trim() : location.trim()

  return {
    ok: true,
    tournament: {
      id: tournament.id,
      name: tournament.name,
      tour: tournament.tour,
      category: tournament.category,
      country,
      city,
      surface: tournament.surface,
      starts_at: tournament.starts_at,
      draw_size: tournament.draw_size as number | null,
      status: tournament.status,
    },
  }
}

export async function updateTournament(
  tournamentId: string,
  data: {
    name: string
    tour: 'ATP' | 'WTA'
    category: 'grand_slam' | 'masters_1000' | '500' | '250'
    country: string
    city: string
    surface: 'hard' | 'clay' | 'grass'
    startsAt: string
    drawSize: 32 | 64 | 128
  },
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()

  const startsAt = new Date(data.startsAt)
  const starts_year = startsAt.getUTCFullYear()
  const durationDays = data.category === 'grand_slam' ? 14 : 7
  const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000)

  const flag = flagForCountry(data.country)

  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .update({
      name: data.name.trim(),
      tour: data.tour,
      category: data.category,
      surface: data.surface,
      location: `${data.city.trim()}, ${data.country.trim()}`,
      flag_emoji: flag,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      starts_year,
      draw_size: data.drawSize,
    })
    .eq('id', tournamentId)

  if (error) return { ok: false, error: error.message }

  // Same reason as updateTournamentDetails: name, location and dates are all
  // rendered into the public edition page and its social card, so an edit that
  // does not bust the tag leaves the corrected value behind the ISR window.
  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')
  return { ok: true }
}

export async function getTournamentWithDraw(tournamentId: string): Promise<{
  ok: boolean
  tournament?: {
    id: string; name: string; external_id: string; tour: string; category: string
    status: string; draw_size: number | null; starts_at: string | null
    location: string | null; flag_emoji: string | null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bracketData?: any
  lockedMatches?: Record<string, string>
  matchResults?: Array<{ external_match_id: string; round: string; winner_external_id: string; loser_external_id: string; score: string | null }>
  error?: string
}> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data: tournament, error: tErr } = await admin
    .from('tournaments')
    .select('id, name, external_id, tour, category, status, draw_size, starts_at, location, flag_emoji, draw_close_at')
    .eq('id', tournamentId)
    .single()

  if (tErr || !tournament) return { ok: false, error: tErr?.message ?? 'Tournament not found' }

  const { data: draw } = await admin
    .from('draws')
    .select('bracket_data, locked_matches')
    .eq('tournament_id', tournamentId)
    .single()

  const { data: results } = await admin
    .from('match_results')
    .select('external_match_id, round, winner_external_id, loser_external_id, score')
    .eq('tournament_id', tournamentId)

  return {
    ok: true,
    tournament: tournament as {
      id: string; name: string; external_id: string; tour: string; category: string
      status: string; draw_size: number | null; starts_at: string | null
      location: string | null; flag_emoji: string | null
    },
    bracketData: draw?.bracket_data ?? null,
    lockedMatches: (draw?.locked_matches as Record<string, string>) ?? {},
    matchResults: (results ?? []) as Array<{ external_match_id: string; round: string; winner_external_id: string; loser_external_id: string; score: string | null }>,
  }
}

// ── Structured draw builder ──────────────────────────────────────────────────
// Builds a draw from player external_ids (sourced from the players table).
// Unlike saveManualDraw (text-based), this uses structured player objects.

export async function buildDraw(
  tournamentId: string,
  slots: Array<{ player1ExternalId: string | null; player2ExternalId: string | null }>,
): Promise<{ ok: boolean; error?: string; matchCount?: number }> {
  await assertAdmin()
  if (!slots.length) return { ok: false, error: 'No matches provided' }

  const admin = createAdminClient()

  // Load tournament
  const { data: tournament, error: tErr } = await admin
    .from('tournaments')
    .select('id, external_id, draw_size, tour, name, location, flag_emoji, draw_close_at')
    .eq('id', tournamentId)
    .single()

  if (tErr || !tournament) return { ok: false, error: tErr?.message ?? 'Tournament not found' }

  const drawSize = tournament.draw_size as number
  const expectedMatches = drawSize / 2
  if (slots.length !== expectedMatches) {
    return { ok: false, error: `Expected ${expectedMatches} matches for draw size ${drawSize}, got ${slots.length}` }
  }

  // Collect all player external_ids to load from players table
  const playerIds = new Set<string>()
  for (const slot of slots) {
    if (slot.player1ExternalId) playerIds.add(slot.player1ExternalId)
    if (slot.player2ExternalId) playerIds.add(slot.player2ExternalId)
  }

  // Load player records
  const playerMap = new Map<string, { externalId: string; name: string; country: string }>()
  if (playerIds.size > 0) {
    const { data: players } = await admin
      .from('players')
      .select('external_id, name, country')
      .in('external_id', Array.from(playerIds))
    for (const p of players ?? []) {
      playerMap.set(p.external_id, { externalId: p.external_id, name: p.name, country: p.country })
    }
  }

  // Compute rounds from draw size
  const drawSizeToFirstRound: Record<number, number> = { 128: 0, 64: 1, 32: 2 }
  const startIdx = drawSizeToFirstRound[drawSize]
  if (startIdx === undefined) return { ok: false, error: `Unsupported draw size: ${drawSize}` }
  const rounds = ROUND_ORDER.slice(startIdx)
  const firstRound = rounds[0]
  const externalId = tournament.external_id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMatches: any[] = []

  // First round — players from slots
  slots.forEach((slot, i) => {
    const idx = String(i + 1).padStart(3, '0')
    const matchId = `${externalId}-${firstRound}-${idx}`
    const resolveSlot = (extId: string | null, which: 'player1' | 'player2') => {
      if (!extId) return null
      // A placeholder id is derived from its slot, never from a running counter:
      // resolving one qualifier must not renumber the others, or every pick
      // stored against a later placeholder quietly starts meaning a different
      // match. See qualifierSlotId.
      if (extId === 'QUALIFIER') {
        return { externalId: qualifierSlotId(i, which), name: 'Qualifier', country: '' }
      }
      return playerMap.get(extId) ?? null
    }
    allMatches.push({
      matchId,
      round: firstRound,
      player1: resolveSlot(slot.player1ExternalId, 'player1'),
      player2: resolveSlot(slot.player2ExternalId, 'player2'),
    })
  })

  // Subsequent rounds — TBD (null players)
  let prevCount = slots.length
  for (let ri = 1; ri < rounds.length; ri++) {
    const round = rounds[ri]
    const count = Math.ceil(prevCount / 2)
    for (let i = 0; i < count; i++) {
      allMatches.push({
        matchId: `${externalId}-${round}-${String(i + 1).padStart(3, '0')}`,
        round,
        player1: null,
        player2: null,
      })
    }
    prevCount = count
  }

  // Handle BYEs: auto-advance the non-BYE player by creating match_results
  const byeResults: Array<{
    tournament_id: string; external_match_id: string; round: string
    winner_external_id: string; loser_external_id: string; score: string; played_at: string
  }> = []
  for (const match of allMatches) {
    if (match.round !== firstRound) continue
    const hasP1 = match.player1 !== null
    const hasP2 = match.player2 !== null
    if (hasP1 && !hasP2) {
      byeResults.push({
        tournament_id: tournamentId,
        external_match_id: match.matchId,
        round: firstRound,
        winner_external_id: match.player1.externalId,
        loser_external_id: 'bye',
        score: 'BYE',
        played_at: new Date().toISOString(),
      })
    } else if (!hasP1 && hasP2) {
      byeResults.push({
        tournament_id: tournamentId,
        external_match_id: match.matchId,
        round: firstRound,
        winner_external_id: match.player2.externalId,
        loser_external_id: 'bye',
        score: 'BYE',
        played_at: new Date().toISOString(),
      })
    }
  }

  const draw = { tournamentExternalId: externalId, rounds, matches: allMatches }

  // Read the draw we are about to destroy: it is the only record of which id
  // each qualifier slot used to carry, and stored picks reference those ids.
  const { data: oldDrawRow, error: oldDrawError } = await admin
    .from('draws')
    .select('bracket_data')
    .eq('tournament_id', tournamentId)
    .maybeSingle()
  if (oldDrawError) console.error('[buildDraw] failed to read prior draw:', oldDrawError.message)

  const { error: drawError } = await admin
    .from('draws')
    .upsert(
      { tournament_id: tournamentId, bracket_data: draw as unknown, synced_at: new Date().toISOString() },
      { onConflict: 'tournament_id' },
    )
  if (drawError) return { ok: false, error: drawError.message }

  // Re-publishing a draw with the qualifiers filled in is the whole point of the
  // second save, so every pick that named a placeholder has to follow the slot.
  // Without this the pick is dangling: it can never match a result, the cron
  // awards nothing, and the tournament page keeps calling the player "Qualifier".
  try {
    const summary = await remapResolvedQualifiers(
      admin, tournamentId, oldDrawRow?.bracket_data as unknown as DrawLike | null, draw, 'buildDraw',
    )
    if (summary) console.log(`[buildDraw] "${tournament.name}": ${summary}`)
  } catch (remapErr) {
    console.error('[buildDraw] qualifier remap failed:', remapErr)
  }

  // Insert BYE results so they show as resolved
  if (byeResults.length > 0) {
    await admin
      .from('match_results')
      .upsert(byeResults, { onConflict: 'tournament_id,external_match_id' })
  }

  // Open predictions — forward-only, so re-saving the draw of a tournament
  // that is already under way cannot demote it. See DRAW_OPENABLE_STATUSES.
  await admin
    .from('tournaments')
    .update({ status: 'accepting_predictions' })
    .eq('id', tournamentId)
    .in('status', DRAW_OPENABLE_STATUSES)

  // Notify + email users. Safe to call unconditionally even when the status
  // write above matched nothing: the announcement is claimed atomically via
  // `draw_announced_at` (070), so a re-save is already a no-op here.
  await announceDrawOpen(tournamentId)

  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')

  return { ok: true, matchCount: allMatches.length }
}

// ── Structured result entry ──────────────────────────────────────────────────
// Enter a single match result by matchId (must match bracket_data matchId).

/**
 * Find all downstream match IDs that involve a specific player.
 * Walks forward through the bracket from the given round to find
 * matches where the player appears as winner or loser.
 */
async function findDownstreamResults(
  admin: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  playerExternalId: string,
  fromRound: string,
): Promise<string[]> {
  const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']
  const startIdx = ROUND_ORDER.indexOf(fromRound)
  if (startIdx < 0) return []

  // Get all results for rounds AFTER the given round
  const laterRounds = ROUND_ORDER.slice(startIdx + 1)
  if (laterRounds.length === 0) return []

  const { data: results } = await admin
    .from('match_results')
    .select('external_match_id, winner_external_id, loser_external_id')
    .eq('tournament_id', tournamentId)
    .in('round', laterRounds)

  // Find results where this player appears
  return (results ?? [])
    .filter(r => r.winner_external_id === playerExternalId || r.loser_external_id === playerExternalId)
    .map(r => r.external_match_id)
}

export async function saveMatchResult(
  tournamentId: string,
  matchId: string,
  winnerExternalId: string,
  loserExternalId: string,
  score?: string,
): Promise<{ ok: boolean; error?: string; cascadeDeleted?: string[] }> {
  await assertAdmin()
  const admin = createAdminClient()

  // Determine round from matchId (format: "ext-id-ROUND-001")
  const parts = matchId.split('-')
  const roundSegment = parts[parts.length - 2]
  const validRounds = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']
  if (!validRounds.includes(roundSegment)) {
    return { ok: false, error: `Cannot determine round from matchId "${matchId}"` }
  }

  // Check if we're editing an existing result (winner changed)
  let cascadeDeleted: string[] = []
  const { data: existingResult } = await admin
    .from('match_results')
    .select('winner_external_id')
    .eq('tournament_id', tournamentId)
    .eq('external_match_id', matchId)
    .maybeSingle()

  if (existingResult && existingResult.winner_external_id !== winnerExternalId) {
    // Winner changed — cascade delete downstream results involving the OLD winner
    const oldWinner = existingResult.winner_external_id
    const downstream = await findDownstreamResults(admin, tournamentId, oldWinner, roundSegment)
    if (downstream.length > 0) {
      await admin
        .from('match_results')
        .delete()
        .eq('tournament_id', tournamentId)
        .in('external_match_id', downstream)
      cascadeDeleted = downstream
    }
  }

  const { error } = await admin
    .from('match_results')
    .upsert({
      tournament_id: tournamentId,
      external_match_id: matchId,
      round: roundSegment,
      winner_external_id: winnerExternalId,
      loser_external_id: loserExternalId,
      score: (score ?? '').trim() || null,
      played_at: new Date().toISOString(),
    }, { onConflict: 'tournament_id,external_match_id' })

  if (error) return { ok: false, error: error.message }

  // Transition to in_progress on first real result (non-BYE)
  if (loserExternalId !== 'bye') {
    await admin
      .from('tournaments')
      .update({ status: 'in_progress' })
      .eq('id', tournamentId)
      .eq('status', 'accepting_predictions')
  }

  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')
  return { ok: true, cascadeDeleted }
}

/** Clear a match result and cascade-delete downstream results involving the winner. */
export async function clearMatchResult(
  tournamentId: string,
  matchId: string,
): Promise<{ ok: boolean; error?: string; cascadeDeleted?: string[] }> {
  await assertAdmin()
  const admin = createAdminClient()

  // Get the existing result to find the winner for cascade
  const { data: existing } = await admin
    .from('match_results')
    .select('winner_external_id, round')
    .eq('tournament_id', tournamentId)
    .eq('external_match_id', matchId)
    .maybeSingle()

  if (!existing) return { ok: false, error: 'No result found for this match' }

  // Cascade delete downstream results involving this winner
  let cascadeDeleted: string[] = []
  const downstream = await findDownstreamResults(admin, tournamentId, existing.winner_external_id, existing.round)
  if (downstream.length > 0) {
    await admin
      .from('match_results')
      .delete()
      .eq('tournament_id', tournamentId)
      .in('external_match_id', downstream)
    cascadeDeleted = downstream
  }

  // Delete the result itself
  const { error } = await admin
    .from('match_results')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('external_match_id', matchId)

  if (error) return { ok: false, error: error.message }

  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')
  return { ok: true, cascadeDeleted }
}

// ── Cron runs log ──────────────────────────────────────────────────────────

export interface CronRun {
  id: string
  job_name: string
  status: string
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  summary: Record<string, unknown> | null
  error: string | null
}

export async function getCronRuns(): Promise<CronRun[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('cron_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[admin] Failed to fetch cron runs:', error)
    return []
  }
  return (data ?? []) as CronRun[]
}

// ── Auto-Predict admin actions ──────────────────────────────────────────────

export type AutoPredictStats = {
  enabledCount: number
  recentRuns: Array<{
    id: string
    tournament_id: string
    triggered_by: string
    users_processed: number
    predictions_created: number
    predictions_updated: number
    created_at: string
  }>
}

export async function getAutoPredictStats(): Promise<AutoPredictStats> {
  await assertAdmin()
  const admin = createAdminClient()

  const [{ count }, { data: runs }] = await Promise.all([
    admin.from('users').select('id', { count: 'exact', head: true }).eq('auto_predict_enabled', true),
    admin.from('auto_predict_runs')
      .select('id, tournament_id, triggered_by, users_processed, predictions_created, predictions_updated, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  return {
    enabledCount: count ?? 0,
    recentRuns: (runs ?? []) as AutoPredictStats['recentRuns'],
  }
}

export async function searchUsersForAutoPredict(
  query: string,
): Promise<{ users: Array<{ id: string; username: string; auto_predict_enabled: boolean }> }> {
  await assertAdmin()
  const admin = createAdminClient()

  let q = admin
    .from('users')
    .select('id, username, auto_predict_enabled')
    .order('username')
    .limit(20)

  if (query.trim()) {
    q = q.ilike('username', `%${query}%`)
  }

  const { data } = await q
  return { users: (data ?? []) as Array<{ id: string; username: string; auto_predict_enabled: boolean }> }
}

export async function toggleAutoPredict(
  userId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('users')
    .update({ auto_predict_enabled: enabled } as any)
    .eq('id', userId)
    .select('id, auto_predict_enabled')
    .single()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'User not found' }
  return { ok: true }
}

// ── App Settings ─────────────────────────────────────────────────────────────

import type { PredictionMode } from '@/lib/app-settings'

export type AppSettings = {
  prediction_mode: PredictionMode
}

export async function getAppSettings(): Promise<AppSettings> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('app_settings')
    .select('key, value')

  if (error || !data) return { prediction_mode: 'anytime' }

  const settings: AppSettings = { prediction_mode: 'anytime' }
  for (const row of data) {
    if (row.key === 'prediction_mode') {
      const v = String(row.value)
      settings.prediction_mode = v.includes('pre_tournament') ? 'pre_tournament'
        : v.includes('manual_lock') ? 'manual_lock'
        : 'anytime'
    }
  }
  return settings
}

export async function updatePredictionMode(
  mode: PredictionMode,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const VALID_MODES: PredictionMode[] = ['anytime', 'pre_tournament', 'manual_lock']
  if (!VALID_MODES.includes(mode)) {
    return { ok: false, error: 'Invalid mode' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('app_settings')
    .upsert(
      { key: 'prediction_mode', value: mode, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )

  if (error) return { ok: false, error: error.message }

  // Bust the cached prediction mode so all pages pick it up immediately
  revalidateTag('app-settings', 'default')

  return { ok: true }
}

// ── Match Locks (manual_lock mode) ──────────────────────────────────────────

/**
 * Lock specific matches for a tournament.
 * Adds matchIds to draws.locked_matches JSONB with current timestamp.
 */
export async function lockMatches(
  tournamentId: string,
  matchIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  if (!matchIds.length) return { ok: false, error: 'No match IDs provided' }

  const admin = createAdminClient()

  // Fetch current locked_matches
  const { data: draw, error: fetchErr } = await admin
    .from('draws')
    .select('locked_matches')
    .eq('tournament_id', tournamentId)
    .single()

  if (fetchErr || !draw) return { ok: false, error: fetchErr?.message ?? 'Draw not found' }

  const current = (draw.locked_matches as Record<string, string>) ?? {}
  const now = new Date().toISOString()
  const updated = { ...current }
  for (const id of matchIds) {
    if (!updated[id]) updated[id] = now
  }

  const { error } = await admin
    .from('draws')
    .update({ locked_matches: updated })
    .eq('tournament_id', tournamentId)

  if (error) return { ok: false, error: error.message }

  revalidateTag('app-settings', 'default')
  return { ok: true }
}

/**
 * Unlock specific matches for a tournament.
 * Removes matchIds from draws.locked_matches JSONB.
 */
export async function unlockMatches(
  tournamentId: string,
  matchIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  if (!matchIds.length) return { ok: false, error: 'No match IDs provided' }

  const admin = createAdminClient()

  const { data: draw, error: fetchErr } = await admin
    .from('draws')
    .select('locked_matches')
    .eq('tournament_id', tournamentId)
    .single()

  if (fetchErr || !draw) return { ok: false, error: fetchErr?.message ?? 'Draw not found' }

  const current = (draw.locked_matches as Record<string, string>) ?? {}
  const updated = { ...current }
  for (const id of matchIds) {
    delete updated[id]
  }

  const { error } = await admin
    .from('draws')
    .update({ locked_matches: updated })
    .eq('tournament_id', tournamentId)

  if (error) return { ok: false, error: error.message }

  revalidateTag('app-settings', 'default')
  return { ok: true }
}

/**
 * Lock all matches in a specific round.
 */
export async function lockRound(
  tournamentId: string,
  round: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()

  // Fetch bracket data to get matchIds for the round
  const { data: draw, error: fetchErr } = await admin
    .from('draws')
    .select('bracket_data, locked_matches')
    .eq('tournament_id', tournamentId)
    .single()

  if (fetchErr || !draw?.bracket_data) return { ok: false, error: fetchErr?.message ?? 'Draw not found' }

  const bracket = draw.bracket_data as { matches: Array<{ matchId: string; round: string }> }
  const roundMatchIds = bracket.matches
    .filter(m => m.round === round)
    .map(m => m.matchId)

  if (!roundMatchIds.length) return { ok: false, error: 'No matches found for this round' }

  const current = (draw.locked_matches as Record<string, string>) ?? {}
  const now = new Date().toISOString()
  const updated = { ...current }
  for (const id of roundMatchIds) {
    if (!updated[id]) updated[id] = now
  }

  const { error } = await admin
    .from('draws')
    .update({ locked_matches: updated })
    .eq('tournament_id', tournamentId)

  if (error) return { ok: false, error: error.message }

  revalidateTag('app-settings', 'default')
  return { ok: true }
}
