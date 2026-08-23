'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdmin } from '../auth'

const PAGE_SIZE = 25

/**
 * How many users a username search may resolve to before it stops widening.
 *
 * The search has to match both registered players (a `users` join) and the
 * display names typed into an anonymous challenge (a column on the row), so it
 * resolves usernames to ids first and filters on those. Every id is ~37 chars
 * inside the `or=(...)` query string and appears twice, so an uncapped list
 * would overflow the URL — the failure mode is a broken request, not a slow one.
 */
const SEARCH_USER_CAP = 20

export type ChallengeStatusFilter =
  | 'all' | 'live' | 'pending' | 'completed' | 'expired' | 'cancelled'
export type ChallengeKind = 'all' | 'friends' | 'anonymous'

/**
 * Statuses that mean "a challenge is currently being played".
 *
 * Two names for one state: a friends challenge the opponent accepted is
 * `accepted`, and an anonymous one whose opponent has submitted is `active`.
 * The award-points cron finalizes them along those two separate paths, so an
 * admin asking "what is happening right now" wants both.
 */
const LIVE_STATUSES = ['accepted', 'active', 'waiting_opponent'] as const

export interface AdminChallengeRow {
  id: string
  status: string
  /** True for a share-link challenge with no accounts behind it (027). */
  isAnonymous: boolean
  /** Present only for anonymous challenges — the /c/[code] route key. */
  shareCode: string | null
  tournamentId: string
  tournamentLabel: string
  tournamentStatus: string | null
  /** Display name for each side: a username, or the typed name when anonymous. */
  challengerName: string | null
  challengedName: string | null
  challengerId: string | null
  challengedId: string | null
  challengerPoints: number | null
  challengedPoints: number | null
  challengerPicks: number | null
  challengedPicks: number | null
  winnerId: string | null
  winnerName: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminChallengeOverview {
  total: number
  live: number
  pending: number
  completed: number
  anonymous: number
}

/**
 * The PostgREST shape. Note what is *not* selected: `creator_token` and
 * `opponent_token` are bearer secrets that let anyone edit that side's bracket
 * on /c/[code], and `creator_picks` / `opponent_picks` are whole brackets. None
 * of them belong in a list payload, so the select names its columns explicitly
 * rather than reaching for `*`.
 */
interface RawChallengeRow {
  id: string
  status: string
  is_anonymous: boolean
  share_code: string | null
  tournament_id: string
  challenger_id: string | null
  challenged_id: string | null
  challenger_points: number | null
  challenged_points: number | null
  challenger_predictions_count: number | null
  challenged_predictions_count: number | null
  creator_name: string | null
  opponent_name: string | null
  winner_id: string | null
  created_at: string
  updated_at: string
  challenger: { username: string | null } | null
  challenged: { username: string | null } | null
  winner: { username: string | null } | null
  tournaments: {
    name: string
    location: string | null
    flag_emoji: string | null
    status: string
  } | null
}

/**
 * One unbroken string literal — a `+` concatenation widens the select to
 * `string` at the type level and collapses the result to GenericStringError.
 *
 * The three `users` embeds are aliased and pinned to their constraint names:
 * `challenges` has three separate foreign keys into `users`, so an unqualified
 * `users(...)` embed is ambiguous and PostgREST rejects it. All three are outer
 * joins, because an anonymous challenge has no account on either side.
 */
const SELECT =
  'id, status, is_anonymous, share_code, tournament_id, challenger_id, challenged_id, ' +
  'challenger_points, challenged_points, challenger_predictions_count, ' +
  'challenged_predictions_count, creator_name, opponent_name, winner_id, created_at, updated_at, ' +
  'challenger:users!challenges_challenger_id_fkey(username), ' +
  'challenged:users!challenges_challenged_id_fkey(username), ' +
  'winner:users!challenges_winner_id_fkey(username), ' +
  'tournaments!challenges_tournament_id_fkey(name, location, flag_emoji, status)'

/** PostgREST filter syntax characters — mapped to wildcards, as listUsers does. */
function sanitize(term: string) {
  return term.trim().replace(/[,()*\\"%]/g, '%')
}

interface ListOptions {
  tournamentId?: string
  status?: ChallengeStatusFilter
  kind?: ChallengeKind
  search?: string
  page?: number
}

/**
 * One page of challenges — friends and anonymous, every status.
 *
 * Filters are pushed to SQL and the page is a `range`, so the work is O(page
 * size). As in the predictions browser there is no `count` on the page query:
 * one extra row is fetched instead, which is all the pager needs.
 */
export async function listChallenges(opts: ListOptions = {}): Promise<{
  ok: boolean
  error?: string
  rows: AdminChallengeRow[]
  hasMore: boolean
  page: number
  pageSize: number
}> {
  await assertAdmin()
  const admin = createAdminClient()

  const page = Math.max(0, opts.page ?? 0)
  const from = page * PAGE_SIZE
  const empty = { rows: [], hasMore: false, page, pageSize: PAGE_SIZE }

  let q = admin.from('challenges').select(SELECT)

  if (opts.tournamentId && opts.tournamentId !== 'all') {
    q = q.eq('tournament_id', opts.tournamentId)
  }
  if (opts.kind === 'friends') q = q.eq('is_anonymous', false)
  if (opts.kind === 'anonymous') q = q.eq('is_anonymous', true)

  const status = opts.status ?? 'all'
  if (status === 'live') q = q.in('status', LIVE_STATUSES as unknown as string[])
  else if (status !== 'all') q = q.eq('status', status)

  const term = sanitize(opts.search ?? '')
  if (term) {
    // Resolve usernames to ids first, then match either side of the challenge
    // or either anonymous display name. Capped — see SEARCH_USER_CAP.
    const { data: matches, error: userErr } = await admin
      .from('users')
      .select('id')
      .ilike('username', `%${term}%`)
      .limit(SEARCH_USER_CAP)

    if (userErr) {
      console.error('[admin-challenges] user search failed:', userErr.message)
      return { ok: false, error: userErr.message, ...empty }
    }

    const ids = ((matches ?? []) as unknown as { id: string }[]).map(u => u.id)
    const clauses = [
      `creator_name.ilike.%${term}%`,
      `opponent_name.ilike.%${term}%`,
      ...(ids.length > 0
        ? [`challenger_id.in.(${ids.join(',')})`, `challenged_id.in.(${ids.join(',')})`]
        : []),
    ]
    q = q.or(clauses.join(','))
  }

  // Tiebreak on id: Postgres gives no stable order among equal keys, which is
  // invisible under LIMIT but duplicates a row across pages under OFFSET.
  q = q
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + PAGE_SIZE)

  const { data, error } = await q
  if (error) {
    console.error('[admin-challenges] page query failed:', error.message)
    return { ok: false, error: error.message, ...empty }
  }

  const fetched = (data ?? []) as unknown as RawChallengeRow[]
  const hasMore = fetched.length > PAGE_SIZE

  const rows: AdminChallengeRow[] = fetched.slice(0, PAGE_SIZE).map(c => {
    const t = c.tournaments
    return {
      id: c.id,
      status: c.status,
      isAnonymous: c.is_anonymous,
      shareCode: c.share_code,
      tournamentId: c.tournament_id,
      tournamentLabel: t
        ? [t.flag_emoji, t.location ?? t.name].filter(Boolean).join(' ')
        : '',
      tournamentStatus: t?.status ?? null,
      // An account's username wins over the typed name: an anonymous challenge
      // that was later claimed has both, and the account is the truer identity.
      challengerName: c.challenger?.username ?? c.creator_name,
      challengedName: c.challenged?.username ?? c.opponent_name,
      challengerId: c.challenger_id,
      challengedId: c.challenged_id,
      challengerPoints: c.challenger_points,
      challengedPoints: c.challenged_points,
      challengerPicks: c.challenger_predictions_count,
      challengedPicks: c.challenged_predictions_count,
      winnerId: c.winner_id,
      winnerName: c.winner?.username ?? null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }
  })

  return { ok: true, rows, hasMore, page, pageSize: PAGE_SIZE }
}

/**
 * Headline counts, ignoring the search box.
 *
 * `head: true` so Postgres returns the number and no rows. Exact throughout:
 * unlike the predictions table, `challenges` is bounded by how many people
 * challenge each other rather than by entrants × tournaments, so counting it
 * stays cheap — 39 rows on 2026-08-23.
 */
export async function getChallengeOverview(opts: {
  tournamentId?: string
  kind?: ChallengeKind
} = {}): Promise<AdminChallengeOverview> {
  await assertAdmin()
  const admin = createAdminClient()

  const base = () => {
    let q = admin.from('challenges').select('id', { count: 'exact', head: true })
    if (opts.tournamentId && opts.tournamentId !== 'all') {
      q = q.eq('tournament_id', opts.tournamentId)
    }
    if (opts.kind === 'friends') q = q.eq('is_anonymous', false)
    if (opts.kind === 'anonymous') q = q.eq('is_anonymous', true)
    return q
  }

  const [total, live, pending, completed, anonymous] = await Promise.all([
    base(),
    base().in('status', LIVE_STATUSES as unknown as string[]),
    base().eq('status', 'pending'),
    base().eq('status', 'completed'),
    base().eq('is_anonymous', true),
  ])

  for (const res of [total, live, pending, completed, anonymous]) {
    if (res.error) console.error('[admin-challenges] count failed:', res.error.message)
  }

  return {
    total: total.count ?? 0,
    live: live.count ?? 0,
    pending: pending.count ?? 0,
    completed: completed.count ?? 0,
    anonymous: anonymous.count ?? 0,
  }
}
