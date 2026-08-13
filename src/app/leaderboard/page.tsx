import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import LeaderboardTable from './LeaderboardTable'
import LeaderboardSelector from './LeaderboardSelector'
import LeaderboardSearch from './LeaderboardSearch'
import Pagination from './Pagination'
import ScopeSegmented from './ScopeSegmented'
import CountryFlag from '@/components/CountryFlag'
import { formatPoints } from '@/lib/utils/format'

export const metadata: Metadata = {
  title: 'Leaderboard',
  alternates: { canonical: '/leaderboard' },
}

type Scope   = 'worldwide' | 'country' | 'city' | 'community'
type Circuit = 'both' | 'atp' | 'wta'

/**
 * The column the board is sorted and ranked by. A union rather than a plain
 * string so `user[pointsField]` type-checks — the circuit toggle swaps this
 * column in the list query, the rank count and the search alike, and they have
 * to stay in agreement or a rank is measured against the wrong ladder.
 */
type PointsField = 'ranking_points' | 'atp_ranking_points' | 'wta_ranking_points'

type LeaderboardUser = {
  id: string
  username: string
  ranking_points: number
  atp_ranking_points: number
  wta_ranking_points: number
  country: string | null
  city: string | null
}

type BreakdownEntry = {
  tournament_id: string
  name: string
  tour: string
  points: number
  flag: string | null
  totalPicks?: number
  correctPicks?: number
  streakPower?: number
  /**
   * Past its 52-week window, so it no longer counts toward the rolling total in
   * the row header. The entry is still listed — expired points are never hidden
   * or deleted, only labelled. Without this the header would read 0 while the
   * drawer still showed the tournament that earned 1000.
   */
  expired?: boolean
}
type UserStats = {
  tournaments: number
  totalPicks: number
  correctPicks: number
  streakPower: number
}

/** Prediction ids per `.in()` filter — bounded so the request URL stays short. */
const LEDGER_CHUNK = 200
/** PostgREST's own response cap. Paging in this size means one extra round trip
 *  only when a result set actually reaches it. */
const LEDGER_PAGE = 1000

/**
 * Build per-user aggregates + per-(user, tournament) stats for the
 * expanded breakdown. Shared between the global and community fetches so
 * the math stays identical — the only difference between them is which
 * users + predictions feed in.
 */
async function buildStats(
  supabase: ReturnType<typeof createAdminClient>,
  userIds: string[],
  userPredictions: any[],
): Promise<{
  breakdownByUser: Record<string, BreakdownEntry[]>
  statsByUser: Record<string, UserStats>
}> {
  // Seed the breakdown list from scoring predictions (points_earned > 0).
  // Keep an indexed pointer so we can enrich each entry with per-tournament
  // stats once we've scanned predictions + point_ledger.
  const breakdownByUser: Record<string, BreakdownEntry[]> = {}
  const breakdownIndex: Record<string, Record<string, BreakdownEntry>> = {}
  const now = Date.now()
  for (const p of userPredictions) {
    const t = p.tournaments as any
    if (!t?.name) continue
    const entry: BreakdownEntry = {
      tournament_id: p.tournament_id,
      name: t.location ?? t.name,
      tour: t.tour ?? '',
      points: p.points_earned ?? 0,
      flag: t.flag_emoji ?? null,
      expired: p.expires_at != null && new Date(p.expires_at).getTime() <= now,
    }
    if (!breakdownByUser[p.user_id]) breakdownByUser[p.user_id] = []
    breakdownByUser[p.user_id].push(entry)
    if (!breakdownIndex[p.user_id]) breakdownIndex[p.user_id] = {}
    breakdownIndex[p.user_id][p.tournament_id] = entry
  }

  const statsByUser: Record<string, UserStats> = {}
  // Per-(user, tournament) counters. Kept separate from statsByUser so the
  // aggregate fields stay comparable to what the table header already shows.
  const pickCountByUT: Record<string, Record<string, number>> = {}
  const correctByUT:   Record<string, Record<string, number>> = {}
  const streakByUT:    Record<string, Record<string, { totalPts: number; basePts: number }>> = {}

  if (userIds.length === 0) return { breakdownByUser, statsByUser }

  // Every prediction (including zero-pointers) so the accuracy denominator
  // counts ALL picks the user made, not just the ones that won points.
  // Paged for the same reason as the ledger below: 50 players' brackets are
  // already at 459 rows and climb with every tournament played, and crossing
  // 1000 would silently shrink the denominator instead of erroring.
  const allPreds: { id: string; user_id: string; tournament_id: string; picks: unknown }[] = []
  for (let offset = 0; ; offset += LEDGER_PAGE) {
    const { data, error } = await supabase
      .from('predictions')
      .select('id, user_id, tournament_id, picks')
      .in('user_id', userIds)
      .is('challenge_id', null)
      .order('id', { ascending: true })
      .range(offset, offset + LEDGER_PAGE - 1)

    if (error) {
      console.error('[leaderboard] predictions page failed:', error.message)
      break
    }
    allPreds.push(...(data ?? []))
    if ((data?.length ?? 0) < LEDGER_PAGE) break
  }

  for (const pred of allPreds ?? []) {
    if (!statsByUser[pred.user_id]) {
      statsByUser[pred.user_id] = { tournaments: 0, totalPicks: 0, correctPicks: 0, streakPower: 1 }
    }
    statsByUser[pred.user_id].tournaments++

    const picks = pred.picks as Record<string, string> | null
    const count = picks ? Object.keys(picks).length : 0
    statsByUser[pred.user_id].totalPicks += count

    if (!pickCountByUT[pred.user_id]) pickCountByUT[pred.user_id] = {}
    pickCountByUT[pred.user_id][pred.tournament_id] =
      (pickCountByUT[pred.user_id][pred.tournament_id] ?? 0) + count
  }

  // Ledger rows → correct picks + streak power, both aggregate and per-
  // tournament. tournament_id is included in the select so we can bucket
  // per pair without a second join.
  const globalPredIds = (allPreds ?? []).map((p: any) => p.id).filter(Boolean)
  const streakAggregate: Record<string, { totalPts: number; basePts: number }> = {}

  for (let i = 0; i < globalPredIds.length; i += LEDGER_CHUNK) {
    const chunk = globalPredIds.slice(i, i + LEDGER_CHUNK)

    /*
     * Paged, not a single read.
     *
     * PostgREST answers with at most 1000 rows and sets no error when it
     * truncates, so this used to lose data in total silence: a 200-prediction
     * chunk really holds ~1300 ledger rows, and the ~300 past the cap came
     * straight off ACCURACY and STREAK POWER for whichever users happened to
     * sort last inside the chunk. The board read 9% where the true figure was
     * 24%. Page until a short page comes back — that is the only signal
     * PostgREST gives that a result set is complete.
     */
    for (let offset = 0; ; offset += LEDGER_PAGE) {
      const { data: ledgerData, error } = await supabase
        .from('point_ledger')
        .select('user_id, tournament_id, points, streak_multiplier')
        .in('prediction_id', chunk)
        // Range paging needs a total order, or pages can repeat and skip rows.
        .order('id', { ascending: true })
        .range(offset, offset + LEDGER_PAGE - 1)

      if (error) {
        console.error('[leaderboard] ledger page failed:', error.message)
        break
      }

      for (const row of ledgerData ?? []) {
        if (!statsByUser[row.user_id]) {
          statsByUser[row.user_id] = { tournaments: 0, totalPicks: 0, correctPicks: 0, streakPower: 1 }
        }
        const pts = row.points ?? 0
        if (pts <= 0) continue

        statsByUser[row.user_id].correctPicks++
        const mult = row.streak_multiplier ?? 1
        const base = pts / mult

        if (!streakAggregate[row.user_id]) streakAggregate[row.user_id] = { totalPts: 0, basePts: 0 }
        streakAggregate[row.user_id].totalPts += pts
        streakAggregate[row.user_id].basePts += base

        if (!correctByUT[row.user_id]) correctByUT[row.user_id] = {}
        correctByUT[row.user_id][row.tournament_id] =
          (correctByUT[row.user_id][row.tournament_id] ?? 0) + 1

        if (!streakByUT[row.user_id]) streakByUT[row.user_id] = {}
        const ut = streakByUT[row.user_id][row.tournament_id] ?? { totalPts: 0, basePts: 0 }
        ut.totalPts += pts
        ut.basePts  += base
        streakByUT[row.user_id][row.tournament_id] = ut
      }

      if ((ledgerData?.length ?? 0) < LEDGER_PAGE) break
    }
  }

  for (const [uid, acc] of Object.entries(streakAggregate)) {
    if (acc.basePts > 0 && statsByUser[uid]) {
      statsByUser[uid].streakPower = acc.totalPts / acc.basePts
    }
  }

  // Enrich each breakdown row with its per-tournament stats.
  for (const [uid, entries] of Object.entries(breakdownByUser)) {
    for (const entry of entries) {
      entry.totalPicks   = pickCountByUT[uid]?.[entry.tournament_id] ?? 0
      entry.correctPicks = correctByUT[uid]?.[entry.tournament_id] ?? 0
      const ut = streakByUT[uid]?.[entry.tournament_id]
      entry.streakPower  = ut && ut.basePts > 0 ? ut.totalPts / ut.basePts : 1
    }
  }

  return { breakdownByUser, statsByUser }
}

const PAGE_SIZE = 50
/** Max search hits shown. Each hit costs one extra rank count, so it is capped. */
const SEARCH_LIMIT = 10

const USER_COLS = 'id, username, ranking_points, atp_ranking_points, wta_ranking_points, country, city'

/**
 * Scope filter for every `users` read on this page — the paginated list, the
 * rank counts and the search all go through it.
 *
 * That shared path is the point: a rank is only meaningful relative to the
 * board it was measured on. A search that ignored scope would report a player
 * as #12 worldwide while the country board they are looking at has them at #3.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST's
// builder returns `this` through a chain of generics that cannot be named at
// this call site; the filters applied below are all statically known.
function applyScopeFilter(
  query: any,
  scope: Scope,
  country: string | null,
  city: string | null,
  communityIds: string[] | null,
) {
  if (scope === 'country' && country) return query.eq('country', country)
  if (scope === 'city' && country && city) return query.eq('country', country).eq('city', city)
  if (scope === 'community' && communityIds) return query.in('id', communityIds)
  return query
}

/**
 * 1-based position of one player on the board.
 *
 * Counts everyone above them using the *same* tiebreak the list query uses:
 * more points, or equal points and a lower id. Counting `points > mine` alone
 * returns the best rank shared by everyone tied — with ~30 players sitting on
 * zero points that is a number no row in the table actually occupies, so
 * "you are #125" would point at someone else entirely.
 */
async function fetchRank(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- takes either
  // the request-scoped or the admin client; they differ only in their auth.
  supabase: any,
  pointsField: PointsField,
  points: number,
  userId: string,
  scope: Scope,
  country: string | null,
  city: string | null,
  communityIds: string[] | null,
): Promise<number | null> {
  let query = supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .not('username', 'is', null)
  query = applyScopeFilter(query, scope, country, city, communityIds)
  query = query.or(`${pointsField}.gt.${points},and(${pointsField}.eq.${points},id.lt.${userId})`)

  const { count, error } = await query
  if (error) {
    console.error('[leaderboard] rank count failed:', error.message)
    return null
  }
  return (count ?? 0) + 1
}

/** Point-scoring predictions for the rows on screen — seeds the expand drawer. */
async function fetchScoringPredictions(
  supabase: ReturnType<typeof createAdminClient>,
  userIds: string[],
): Promise<unknown[]> {
  if (userIds.length === 0) return []
  const { data, error } = await supabase
    .from('predictions')
    .select('user_id, tournament_id, points_earned, expires_at, tournaments(name, tour, location, flag_emoji)')
    .in('user_id', userIds)
    .is('challenge_id', null)
    .gt('points_earned', 0)
    .order('points_earned', { ascending: false })
    .limit(500)

  if (error) {
    console.error('[leaderboard] scoring predictions failed:', error.message)
    return []
  }
  return data ?? []
}

/**
 * Accepted-friend ids for `userId`, self included.
 *
 * Split out of the board fetch so the friend graph is read once per user rather
 * than once per page of their community board — and so the search path can
 * scope itself to the same set without duplicating the query.
 */
function getCommunityIds(userId: string) {
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()
      const { data: friendships, error } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)

      if (error) {
        console.error('[leaderboard] friendships failed:', error.message)
        return [userId]
      }

      const ids = new Set<string>([userId])
      for (const f of friendships ?? []) {
        ids.add(f.requester_id === userId ? f.addressee_id : f.requester_id)
      }
      return Array.from(ids)
    },
    ['leaderboard-community-ids', userId],
    { revalidate: 60 },
  )()
}

/**
 * One page of the board, plus the total row count for the pager.
 *
 * Community and the global scopes share this function now — the only thing that
 * ever differed was the id filter, which `applyScopeFilter` owns. `cacheKey`
 * gives each user's community board its own slot; shared scopes pass '_'.
 */
function getLeaderboardPage(
  pointsField: PointsField,
  scope: Scope,
  scopeCountry: string | null,
  scopeCity: string | null,
  page: number,
  communityIds: string[] | null,
  cacheKey: string,
) {
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()
      const from = (page - 1) * PAGE_SIZE

      let query = supabase
        .from('users')
        .select(USER_COLS, { count: 'exact' })
        .not('username', 'is', null)
        .order(pointsField, { ascending: false })
        /*
         * Tiebreak — load-bearing, not cosmetic.
         *
         * Postgres guarantees no particular order among equal sort keys, and it
         * is free to pick a different one per query. Under LIMIT 50 that was
         * invisible. Under OFFSET it is not: two requests for adjacent pages can
         * order the ~30 players tied on zero points differently, showing one of
         * them twice and dropping another entirely. Ordering by id after points
         * makes the sequence total, so page N always continues where N-1 ended.
         */
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)
      query = applyScopeFilter(query, scope, scopeCountry, scopeCity, communityIds)

      const { data: users, count, error } = await query
      if (error) {
        /*
         * A range past the end of the board comes back as PostgREST's 416
         * "Requested range not satisfiable" — that is `?page=99` on a four-page
         * board, not a server fault, and it arrives with no count header. Re-ask
         * for the total on its own so the caller can send the visitor somewhere
         * real instead of rendering "0 in total" over a board of 157.
         */
        console.error('[leaderboard] page query failed:', error.message)
        let recount = supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .not('username', 'is', null)
        recount = applyScopeFilter(recount, scope, scopeCountry, scopeCity, communityIds)
        const { count: fallbackTotal } = await recount
        return { users: [] as LeaderboardUser[], breakdownByUser: {}, statsByUser: {}, total: fallbackTotal ?? 0 }
      }

      const userIds = (users ?? []).map(u => u.id)
      const userPredictions = await fetchScoringPredictions(supabase, userIds)
      const { breakdownByUser, statsByUser } = await buildStats(supabase, userIds, userPredictions)

      return { users: (users ?? []) as LeaderboardUser[], breakdownByUser, statsByUser, total: count ?? 0 }
    },
    ['leaderboard', pointsField, scope, scopeCountry ?? '_', scopeCity ?? '_', String(page), cacheKey],
    { revalidate: scope === 'community' ? 60 : 300 },
  )()
}

/**
 * Username search over the whole board, each hit carrying its real position.
 *
 * Deliberately not cached: the key space is whatever anyone types, and the data
 * cache is not the place for unbounded user input. It stays cheap because
 * SEARCH_LIMIT caps the hits and the rank counts run in parallel — each one is
 * an index-only count, not a scan of the board.
 */
async function searchLeaderboard(
  term: string,
  pointsField: PointsField,
  scope: Scope,
  scopeCountry: string | null,
  scopeCity: string | null,
  communityIds: string[] | null,
) {
  const empty = { users: [] as LeaderboardUser[], ranks: {} as Record<string, number>, breakdownByUser: {}, statsByUser: {} }
  const supabase = createAdminClient()

  let query = supabase
    .from('users')
    .select(USER_COLS)
    .not('username', 'is', null)
    .ilike('username', `%${term}%`)
    .order(pointsField, { ascending: false })
    .order('id', { ascending: true })
    .limit(SEARCH_LIMIT)
  query = applyScopeFilter(query, scope, scopeCountry, scopeCity, communityIds)

  const { data: matches, error } = await query
  if (error) {
    console.error('[leaderboard] search failed:', error.message)
    return empty
  }

  const hits = (matches ?? []) as LeaderboardUser[]
  const positions = await Promise.all(
    hits.map(u =>
      fetchRank(supabase, pointsField, u[pointsField] ?? 0, u.id, scope, scopeCountry, scopeCity, communityIds),
    ),
  )
  const ranks: Record<string, number> = {}
  hits.forEach((u, i) => {
    const p = positions[i]
    if (p != null) ranks[u.id] = p
  })

  const userIds = hits.map(u => u.id)
  const userPredictions = await fetchScoringPredictions(supabase, userIds)
  const { breakdownByUser, statsByUser } = await buildStats(supabase, userIds, userPredictions)

  return { users: hits, ranks, breakdownByUser, statsByUser }
}

/**
 * Drops the characters that mean something to LIKE or to PostgREST's filter
 * grammar. Usernames contain none of them, so stripping is both safer and
 * simpler than escaping — an unescaped `%` would otherwise match the whole board.
 */
function sanitizeSearch(raw: string) {
  return raw.replace(/[%_\\(),*]/g, '').trim().slice(0, 40)
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; country?: string; city?: string; circuit?: string; page?: string; q?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Anonymous: show blurred leaderboard preview with signup overlay (FOMO, not a wall)
  if (!user) {
    const { users: previewUsers, breakdownByUser: previewBreakdown } =
      await getLeaderboardPage('ranking_points', 'worldwide', null, null, 1, null, '_')
    return (
      <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        <Nav activePage="leaderboard" />
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
          <div className="mb-6">
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Leaderboard</h1>
            <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: '0.4rem', lineHeight: 1.65 }}>
              Global rankings · Rolling 52-week window · ATP &amp; WTA combined
            </p>
          </div>

          {/* Blurred table + overlay */}
          <div style={{ position: 'relative' }}>
            <div style={{ filter: 'blur(5px)', userSelect: 'none', pointerEvents: 'none' }}>
              <LeaderboardTable
                users={(previewUsers ?? []).map((u, i) => ({
                  id: u.id,
                  username: u.username,
                  country: u.country ?? null,
                  points: u.ranking_points as number,
                  rank: i + 1,
                }))}
                currentUserId=""
                breakdownByUser={previewBreakdown}
                statsByUser={{}}
                scope="worldwide"
              />
            </div>

            {/* Gradient fade + CTA */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to bottom, transparent 0%, rgba(245,242,235,0.5) 30%, rgba(245,242,235,0.97) 60%)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'flex-end',
              paddingBottom: '40px',
            }}>
              <div className="text-center">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--ink)' }}>
                  Sign up to see rankings
                </p>
                <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.25rem', maxWidth: '26rem' }}>
                  Create a free account to compete on the global leaderboard and track your position.
                </p>
                <Link
                  href="/signup"
                  className="px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
                  style={{ background: 'var(--court)', textDecoration: 'none' }}
                >
                  Create account
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const sp = await searchParams
  const scope:   Scope   = (sp.scope   as Scope   | undefined) ?? 'worldwide'
  const circuit: Circuit = (sp.circuit as Circuit | undefined) ?? 'both'
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  // Below 2 characters a search matches most of the board, so it stays off and
  // the normal paginated view renders instead.
  const searchTerm  = sanitizeSearch(sp.q ?? '')
  const isSearching = searchTerm.length >= 2

  // ── Points field based on circuit ───────────────────────────────────────
  const pointsField: PointsField =
    circuit === 'atp' ? 'atp_ranking_points' :
    circuit === 'wta' ? 'wta_ranking_points' :
    'ranking_points'

  // ── Parallel fetch: profile + leaderboard ──────────────────────────────
  const { data: profile } = await supabase
    .from('users')
    .select('username, ranking_points, atp_ranking_points, wta_ranking_points, country, city')
    .eq('id', user.id)
    .single()

  // Determine which scope params to use (URL > user's own location)
  const scopeCountry = sp.country ?? (scope !== 'worldwide' ? profile?.country ?? null : null)
  const scopeCity    = sp.city    ?? (scope === 'city'      ? profile?.city    ?? null : null)

  // ── Leaderboard data ───────────────────────────────────────────────────
  // Community scope needs its member set up front: it scopes the page, the
  // search and the rank count alike.
  const communityIds   = scope === 'community' ? await getCommunityIds(user.id) : null
  const communityCount = communityIds ? communityIds.length - 1 : 0 // excluding self

  let users: LeaderboardUser[] = []
  let breakdownByUser: Record<string, any> = {}
  let statsByUser: Record<string, any> = {}
  let searchRanks: Record<string, number> = {}
  let total = 0

  if (isSearching) {
    // A search replaces the list rather than filtering it — the whole point is
    // to reach players who are nowhere near the page you are on.
    const res = await searchLeaderboard(searchTerm, pointsField, scope, scopeCountry, scopeCity, communityIds)
    users = res.users
    breakdownByUser = res.breakdownByUser
    statsByUser = res.statsByUser
    searchRanks = res.ranks
  } else {
    const res = await getLeaderboardPage(
      pointsField, scope, scopeCountry, scopeCity, page, communityIds,
      scope === 'community' ? user.id : '_',
    )
    users = res.users
    breakdownByUser = res.breakdownByUser
    statsByUser = res.statsByUser
    total = res.total
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const offset     = (page - 1) * PAGE_SIZE

  // ── URL builders ─────────────────────────────────────────────────────────
  // Params that describe *which* board, as opposed to where you are in it.
  // The pager and the search box both build on this, and neither carries the
  // other's state: a new search starts at its own results, and turning the page
  // leaves the search behind.
  const boardParams = new URLSearchParams()
  if (scope !== 'worldwide')                       boardParams.set('scope', scope)
  if (circuit !== 'both')                          boardParams.set('circuit', circuit)
  if ((scope === 'country' || scope === 'city') && scopeCountry) boardParams.set('country', scopeCountry)
  if (scope === 'city' && scopeCity)               boardParams.set('city', scopeCity)
  const baseQuery = boardParams.toString()

  const pageHref = (p: number) => `/leaderboard?${baseQuery ? `${baseQuery}&` : ''}page=${p}`

  // A page number past the end of a non-empty board is a stale or hand-typed
  // URL. Land on the last real page rather than on an empty table.
  if (!isSearching && total > 0 && page > totalPages) redirect(pageHref(totalPages))

  // ── Active tournaments for dropdown selector ─────────────────────────
  const admin = createAdminClient()
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: selectorTournaments } = await admin
    .from('tournaments')
    .select('id, name, location, flag_emoji, tour, status, starts_at')
    .or(`status.in.(accepting_predictions,in_progress),and(status.eq.completed,ends_at.gt.${fourteenDaysAgo})`)
    .order('starts_at', { ascending: false })
    .limit(20)

  // ── My rank: position in the current scope/circuit view ─────────────────
  // Always counted in Postgres rather than read off the visible rows: with the
  // board paginated, "I am on screen" no longer implies anything about rank,
  // and the count is a single index-only lookup.
  const myPoints = profile?.[pointsField] ?? 0
  const myRank = await fetchRank(
    supabase, pointsField, myPoints, user.id, scope, scopeCountry, scopeCity, communityIds,
  )
  const myPage = myRank != null ? Math.ceil(myRank / PAGE_SIZE) : null
  const myRowVisible = users.some(u => u.id === user.id)

  function scopeUrl(s: Scope) {
    const params = new URLSearchParams()
    params.set('scope', s)
    if (circuit !== 'both') params.set('circuit', circuit)
    if (s === 'country' && profile?.country) params.set('country', profile.country)
    if (s === 'city' && profile?.country)    params.set('country', profile.country)
    if (s === 'city' && profile?.city)       params.set('city', profile.city)
    // The search is a lens on the board, not part of it — switching boards
    // keeps the name you were looking for.
    if (isSearching) params.set('q', searchTerm)
    return `/leaderboard?${params.toString()}`
  }

  function circuitUrl(c: Circuit) {
    const params = new URLSearchParams()
    params.set('circuit', c)
    if (scope !== 'worldwide') params.set('scope', scope)
    if (scopeCountry)          params.set('country', scopeCountry)
    if (scopeCity)             params.set('city', scopeCity)
    if (isSearching)           params.set('q', searchTerm)
    return `/leaderboard?${params.toString()}`
  }

  // Scope label for sub-header
  const scopeLabel =
    scope === 'city'    ? (scopeCity    ?? 'City')    :
    scope === 'country' ? (scopeCountry ?? 'Country') :
    'Global rankings — rolling 52 weeks'

  // ── Pill helpers ─────────────────────────────────────────────────────────
  function scopeActive(s: Scope) { return scope === s }
  function circuitActive(c: Circuit) { return circuit === c }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav
        username={profile?.username}
        points={profile?.ranking_points ?? 0}
        activePage="leaderboard"
        userId={user.id}
      />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">

        {/* Title */}
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Leaderboard
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: '0.4rem', lineHeight: 1.65 }}>
            See how your prediction accuracy stacks up against every other player. Rankings update after each match result and roll over a 52-week window.
          </p>
        </div>

        {/* ── Tournament selector ──────────────────────────────────────────── */}
        {(selectorTournaments ?? []).length > 0 && (
          <div className="mb-4">
            <LeaderboardSelector
              tournaments={(selectorTournaments ?? []).map(t => ({
                id: t.id,
                name: t.name,
                location: t.location ?? null,
                flag_emoji: t.flag_emoji ?? null,
                tour: t.tour,
                status: t.status,
              }))}
              currentTournamentId={null}
              currentScope={scope}
            />
          </div>
        )}

        {/* ── Scope + Circuit controls ──────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">

          {/* Scope — segmented control */}
          <ScopeSegmented
            items={[
              { key: 'worldwide', label: 'Worldwide', href: scopeUrl('worldwide'), active: scopeActive('worldwide'), icon: '🌍' },
              profile?.country
                ? { key: 'country', label: profile.country, href: scopeUrl('country'), active: scopeActive('country'), icon: <CountryFlag country={profile.country} size={14} /> }
                : { key: 'country', label: 'Country',      active: false, disabledReason: 'Set your country in profile to unlock', icon: '🏳️' },
              profile?.city
                ? { key: 'city',    label: profile.city,   href: scopeUrl('city'),    active: scopeActive('city'),    icon: '🏙️' }
                : { key: 'city',    label: 'City',         active: false, disabledReason: 'Set your city in profile to unlock', icon: '🏙️' },
              { key: 'community', label: 'My community',   href: scopeUrl('community'), active: scopeActive('community'), icon: '👥' },
            ]}
          />

          {/* Circuit pills */}
          <div className="flex items-center gap-1.5">
            <CircuitBtn href={circuitUrl('both')} active={circuitActive('both')}>Both</CircuitBtn>
            <CircuitBtn href={circuitUrl('atp')}  active={circuitActive('atp')}>ATP</CircuitBtn>
            <CircuitBtn href={circuitUrl('wta')}  active={circuitActive('wta')}>WTA</CircuitBtn>
          </div>
        </div>

        {/* ── Location nudge (inline, below pills) ────────────────────────── */}
        {!profile?.country && (
          <div className="mb-6 px-4 py-3 rounded-sm border" style={{ background: '#fefcf3', borderColor: '#e8dfc0' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--ink)', lineHeight: 1.5 }}>
              To unblock Country, City leaderboards, please{' '}
              <Link href={`/profile/${profile?.username}`} style={{ color: 'var(--court)', fontWeight: 500 }}>
                set up your location on your profile page
              </Link>.
            </p>
          </div>
        )}

        {/* ── Search ────────────────────────────────────────────────────────── */}
        <LeaderboardSearch
          initialQuery={searchTerm}
          baseQuery={baseQuery}
          scopeLabel={
            scope === 'community' ? 'in your community' :
            scope === 'city'      ? `in ${scopeCity ?? 'your city'}` :
            scope === 'country'   ? `in ${scopeCountry ?? 'your country'}` :
            'worldwide'
          }
        />

        {/* ── My rank highlight ──────────────────────────────────────────────── */}
        {myRank !== null && (
          <div className="mb-6 px-5 py-4 rounded-sm border" style={{ background: '#edf4fc', borderColor: '#b8d4f0' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-4 min-w-0">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#1e4e8c', flexShrink: 0 }}>
                  #{myRank}
                </span>
                <span className="truncate" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: '#1e4e8c' }}>
                  {profile?.username} (you)
                </span>
              </div>
              <span className="flex-shrink-0" style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#1e4e8c', fontWeight: 500 }}>
                {formatPoints(myPoints)} pts
              </span>
            </div>
            {/* Every row is reachable now, so this stops being a dead end and
                becomes the link to the page you are actually on. */}
            {!myRowVisible && myPage !== null && (
              <Link
                href={pageHref(myPage)}
                className="inline-block hover:underline"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#1e4e8c', marginTop: '0.4rem', textDecoration: 'none' }}
              >
                Jump to page {myPage} →
              </Link>
            )}
          </div>
        )}

        {/* ── Community empty-state nudge ───────────────────────────────────── */}
        {scope === 'community' && communityCount === 0 && (
          <div
            className="mb-4 flex items-start gap-3 rounded-sm border px-4 py-3"
            style={{ background: '#eef4ff', borderColor: '#B8D4F0' }}
          >
            <span style={{ fontSize: '1.15rem', flexShrink: 0, marginTop: '1px' }}>👥</span>
            <div className="flex-1 min-w-0">
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', color: 'var(--ink)', marginBottom: '2px' }}>
                Your community is just you for now
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.03em', lineHeight: 1.5 }}>
                Invite friends to fill this board — you&apos;ll share a head-to-head record with every one of them.
              </p>
            </div>
            <Link
              href="/invite"
              className="flex-shrink-0 self-center"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                padding: '6px 10px',
                borderRadius: '2px',
                background: 'var(--court)',
                color: '#fff',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Invite →
            </Link>
          </div>
        )}

        {/* ── Table ─────────────────────────────────────────────────────────── */}
        <LeaderboardTable
          users={users.map((u, i) => ({
            id: u.id,
            username: u.username,
            country: u.country ?? null,
            points: u[pointsField],
            // Search hits carry their own position on the board; list rows are
            // simply their offset within it.
            rank: isSearching ? (searchRanks[u.id] ?? 0) : offset + i + 1,
          }))}
          currentUserId={user.id}
          breakdownByUser={breakdownByUser}
          statsByUser={statsByUser}
          scope={scope}
          emptyTitle={isSearching ? 'No players found' : undefined}
          emptyHint={isSearching ? `No username matching “${searchTerm}” on this board.` : undefined}
        />

        {!isSearching && <Pagination page={page} totalPages={totalPages} baseQuery={baseQuery} />}

        <p className="mt-4 text-center" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {isSearching
            ? users.length === 0
              ? `No matches for “${searchTerm}”`
              : `${users.length}${users.length === SEARCH_LIMIT ? '+' : ''} match${users.length === 1 ? '' : 'es'} for “${searchTerm}” · Ranks are positions on this board`
            : users.length === 0
              ? `No players on page ${page} · ${total} in total`
              : scope === 'community'
                ? `You and ${communityCount} friend${communityCount === 1 ? '' : 's'} · Rolling 52-week window · Points update after each result`
                : `Showing ${offset + 1}–${offset + users.length} of ${total} players · Rolling 52-week window · Points update after each result`}
        </p>

      </div>
    </main>
  )
}

// ── Small helper components ───────────────────────────────────────────────────

const hStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  color: 'var(--muted)',
  letterSpacing: '0.05em',
}

function CircuitBtn({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-xs rounded-sm border transition-colors whitespace-nowrap"
      style={{
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.03em',
        borderColor: active ? 'var(--ink)' : 'var(--chalk-dim)',
        color: active ? 'var(--ink)' : 'var(--muted)',
        background: active ? '#f4f0eb' : 'white',
        fontWeight: active ? 600 : 400,
        textDecoration: 'none',
      }}
    >
      {children}
    </Link>
  )
}
