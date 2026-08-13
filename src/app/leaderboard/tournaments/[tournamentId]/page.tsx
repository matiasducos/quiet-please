import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import { gateRedirect } from '@/lib/auth-redirect'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentResultsTable from '@/components/TournamentResultsTable'
import type { TournamentInfo, PlayerResult } from '@/components/TournamentResultsTable'
import LeaderboardSelector from '../../LeaderboardSelector'
import LeaderboardSearch from '../../LeaderboardSearch'
import Pagination from '../../Pagination'
import ScopeSegmented from '../../ScopeSegmented'
import CountryFlag from '@/components/CountryFlag'
import { SEARCH_LIMIT, isSearchActive, sanitizeSearch } from '@/lib/utils/search'

type Scope = 'worldwide' | 'country' | 'city' | 'community'

const PAGE_SIZE = 50

export default async function GlobalTournamentResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tournamentId: string }>
  searchParams: Promise<{ scope?: string; country?: string; city?: string; page?: string; q?: string }>
}) {
  const { user, profile } = await getNavProfile()

  const { tournamentId } = await params
  if (!user) redirect(gateRedirect(`/leaderboard/tournaments/${tournamentId}`, 'new'))
  const sp = await searchParams
  const scope: Scope = (sp.scope as Scope | undefined) ?? 'worldwide'
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const searchTerm  = sanitizeSearch(sp.q ?? '')
  const isSearching = isSearchActive(searchTerm)
  const supabase = await createClient()
  const admin = createAdminClient()

  // Fetch tournament + viewer's profile (for country/city scopes) + selector list
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const [
    { data: tournament },
    { data: viewerProfile },
    { data: selectorTournaments },
  ] = await Promise.all([
    admin.from('tournaments')
      .select('id, name, tour, category, surface, location, flag_emoji, starts_at, ends_at, status')
      .eq('id', tournamentId)
      .single(),
    supabase.from('users')
      .select('country, city')
      .eq('id', user.id)
      .single(),
    admin.from('tournaments')
      .select('id, name, location, flag_emoji, tour, status, starts_at')
      .or(`status.in.(accepting_predictions,in_progress),and(status.eq.completed,ends_at.gt.${fourteenDaysAgo})`)
      .order('starts_at', { ascending: false })
      .limit(20),
  ])

  if (!tournament) notFound()

  // ── Resolve scope filters ────────────────────────────────────────────────
  // Worldwide: no extra filter.
  // Country/City: filter via the embedded users join on PostgREST.
  // Community: pre-resolve the set of allowed user_ids (self + accepted friends)
  //            and filter predictions with .in('user_id', ...).
  const scopeCountry = sp.country ?? (scope !== 'worldwide' ? viewerProfile?.country ?? null : null)
  const scopeCity    = sp.city    ?? (scope === 'city'      ? viewerProfile?.city    ?? null : null)

  let communityIds: string[] | null = null
  let communityCount = 0
  if (scope === 'community') {
    const { data: friendships } = await admin
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)

    const ids = new Set<string>([user.id])
    for (const f of friendships ?? []) {
      ids.add(f.requester_id === user.id ? f.addressee_id : f.requester_id)
    }
    communityIds = Array.from(ids)
    communityCount = communityIds.length - 1 // excluding self
  }

  // ── Predictions query ────────────────────────────────────────────────────
  // The users join shape changes depending on what we filter on:
  //   • worldwide/community → `users(username, country)`; community filters on
  //     the user_id set instead of the join
  //   • country/city        → `users!inner(username, country, city)` + .eq()
  //     filters on the embedded columns
  //   • any scope + search  → the join must be `!inner` too, because a filter
  //     on `users.username` cannot run through an outer one
  const joinsOnUsers = scope === 'country' || scope === 'city'
  const needsInnerJoin = joinsOnUsers || isSearching
  const rowSelect =
    `id, user_id, points_earned, picks, is_fully_locked, ` +
    `users${needsInnerJoin ? '!inner' : ''}(${joinsOnUsers ? 'username, country, city' : 'username, country'})`

  /** Scope filters only — never the username search, which must not narrow a rank. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST's
  // builder returns `this` through a chain of generics that cannot be named at
  // this call site; the filters applied below are all statically known.
  function applyScope(q: any) {
    if (scope === 'country' && scopeCountry) return q.eq('users.country', scopeCountry)
    if (scope === 'city' && scopeCountry && scopeCity) return q.eq('users.country', scopeCountry).eq('users.city', scopeCity)
    if (scope === 'community' && communityIds) return q.in('user_id', communityIds)
    return q
  }

  /**
   * 1-based position of one entry on this tournament's board.
   *
   * Counts entries above it with the same tiebreak the list uses: more points,
   * or equal points and a lower id. On a tournament board this matters more
   * than on the global one — most entrants share a handful of distinct scores,
   * so a plain `points > theirs` count would return the same rank for dozens of
   * players and land on none of them.
   */
  async function fetchEntryRank(points: number, predictionId: string): Promise<number | null> {
    let q = admin
      .from('predictions')
      // The embedded join has to survive into the count query, or the
      // country/city filters below have nothing to attach to.
      .select(joinsOnUsers ? 'id, users!inner(id)' : 'id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .is('challenge_id', null)
    q = applyScope(q)
    q = q.or(`points_earned.gt.${points},and(points_earned.eq.${points},id.lt.${predictionId})`)

    const { count, error } = await q
    if (error) {
      console.error('[tournament-leaderboard] rank count failed:', error.message)
      return null
    }
    return (count ?? 0) + 1
  }

  const from = (page - 1) * PAGE_SIZE
  let predQuery = admin
    .from('predictions')
    .select(rowSelect, { count: 'exact' })
    .eq('tournament_id', tournamentId)
    .is('challenge_id', null)
    .order('points_earned', { ascending: false })
    /*
     * Tiebreak. Postgres gives no stable order among equal scores and may pick
     * a different one per query — invisible under LIMIT 50, but under OFFSET it
     * shows one entrant twice and drops another. Tournament boards are the worst
     * case for this: entrants cluster hard on a few point totals.
     */
    .order('id', { ascending: true })
  predQuery = applyScope(predQuery)

  if (isSearching) {
    predQuery = predQuery.ilike('users.username', `%${searchTerm}%`).limit(SEARCH_LIMIT)
  } else {
    predQuery = predQuery.range(from, from + PAGE_SIZE - 1)
  }

  const { data: predictions, count: predCount, error: predError } = await predQuery
  if (predError) console.error('[tournament-leaderboard] page query failed:', predError.message)

  // ── Paging bounds ────────────────────────────────────────────────────────
  // `?page=` past the end is a 416 from PostgREST — no rows and, importantly,
  // no count header — so the real total has to be asked for separately before
  // we can send the visitor to a page that exists.
  let total = predCount ?? 0
  if (predError && !isSearching) {
    let recount = admin
      .from('predictions')
      .select(joinsOnUsers ? 'id, users!inner(id)' : 'id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .is('challenge_id', null)
    recount = applyScope(recount)
    const { count: fallbackTotal } = await recount
    total = fallbackTotal ?? 0
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Params describing which board, as opposed to where you are in it.
  const boardParams = new URLSearchParams()
  if (scope !== 'worldwide') boardParams.set('scope', scope)
  if ((scope === 'country' || scope === 'city') && scopeCountry) boardParams.set('country', scopeCountry)
  if (scope === 'city' && scopeCity) boardParams.set('city', scopeCity)
  const baseQuery = boardParams.toString()
  const basePath  = `/leaderboard/tournaments/${tournamentId}`

  if (!isSearching && total > 0 && page > totalPages) {
    redirect(`${basePath}?${baseQuery ? `${baseQuery}&` : ''}page=${totalPages}`)
  }

  // Ranks for search hits: each is its real position on the board, not its
  // index among the matches.
  const rankByPrediction: Record<string, number> = {}
  if (isSearching) {
    // The select string is built at runtime, so supabase infers no row type here.
    const hits = (predictions ?? []) as unknown as { id: string; points_earned: number }[]
    const positions = await Promise.all(
      hits.map(p => fetchEntryRank(p.points_earned ?? 0, p.id)),
    )
    hits.forEach((p, i) => {
      const rank = positions[i]
      if (rank != null) rankByPrediction[p.id] = rank
    })
  }

  // ── Correct-picks + streak-power per user from point_ledger ─────────────
  const globalPredIds = (predictions ?? []).map((p: any) => p.id).filter(Boolean)
  const correctPicksByUser: Record<string, number> = {}
  const streakAccumByUser: Record<string, { totalPts: number; basePts: number }> = {}
  if (globalPredIds.length > 0) {
    const { data: ledgerRows } = await admin.from('point_ledger')
      .select('user_id, points, streak_multiplier')
      .in('prediction_id', globalPredIds)
      .gt('points', 0)
    for (const row of ledgerRows ?? []) {
      correctPicksByUser[row.user_id] = (correctPicksByUser[row.user_id] ?? 0) + 1
      const pts = row.points ?? 0
      const mult = row.streak_multiplier ?? 1
      if (!streakAccumByUser[row.user_id]) streakAccumByUser[row.user_id] = { totalPts: 0, basePts: 0 }
      streakAccumByUser[row.user_id].totalPts += pts
      streakAccumByUser[row.user_id].basePts += pts / mult
    }
  }

  const players: PlayerResult[] = (predictions ?? []).map((p: any, i: number) => {
    const acc = streakAccumByUser[p.user_id]
    return {
      // Search hits carry their real position on the board; list rows are their
      // offset within it. Never the array index — that is only page-local.
      rank: isSearching ? (rankByPrediction[p.id] ?? 0) : from + i + 1,
      user_id: p.user_id,
      username: p.users?.username ?? 'Unknown',
      country: p.users?.country ?? null,
      points: p.points_earned ?? 0,
      correct_picks: correctPicksByUser[p.user_id] ?? 0,
      total_picks: Object.keys(p.picks ?? {}).length,
      streak_power: acc && acc.basePts > 0 ? acc.totalPts / acc.basePts : 1,
      isMe: p.user_id === user.id,
      picks_locked: p.is_fully_locked === true,
    }
  })

  const tournamentInfo: TournamentInfo = {
    id: tournament.id,
    name: tournament.name,
    tour: tournament.tour,
    category: tournament.category,
    surface: tournament.surface,
    location: tournament.location,
    flag_emoji: tournament.flag_emoji,
    starts_at: tournament.starts_at,
    ends_at: tournament.ends_at,
    status: tournament.status,
  }

  // ── URL builder preserving scope/country/city across tournament switches ─
  function scopeUrl(s: Scope) {
    const params = new URLSearchParams()
    params.set('scope', s)
    if (s === 'country' && viewerProfile?.country) params.set('country', viewerProfile.country)
    if (s === 'city' && viewerProfile?.country)    params.set('country', viewerProfile.country)
    if (s === 'city' && viewerProfile?.city)       params.set('city', viewerProfile.city)
    // The search is a lens on the board, not part of it — switching scope
    // keeps the name you were looking for.
    if (isSearching) params.set('q', searchTerm)
    return `/leaderboard/tournaments/${tournamentId}?${params.toString()}`
  }
  const scopeActive = (s: Scope) => scope === s

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leaderboard" userId={user.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        {/* Tournament selector dropdown */}
        <div className="mb-4">
          <LeaderboardSelector
            tournaments={(selectorTournaments ?? []).map(t => ({
              id: t.id, name: t.name, location: t.location ?? null,
              flag_emoji: t.flag_emoji ?? null, tour: t.tour, status: t.status,
            }))}
            currentTournamentId={tournamentId}
            currentScope={scope}
          />
        </div>

        {/* Scope segmented control */}
        <div className="mb-6">
          <ScopeSegmented
            items={[
              { key: 'worldwide', label: 'Worldwide', href: scopeUrl('worldwide'), active: scopeActive('worldwide'), icon: '🌍' },
              viewerProfile?.country
                ? { key: 'country', label: viewerProfile.country, href: scopeUrl('country'), active: scopeActive('country'), icon: <CountryFlag country={viewerProfile.country} size={14} /> }
                : { key: 'country', label: 'Country',             active: false, disabledReason: 'Set your country in profile to unlock', icon: '🏳️' },
              viewerProfile?.city
                ? { key: 'city',    label: viewerProfile.city,    href: scopeUrl('city'),    active: scopeActive('city'),    icon: '🏙️' }
                : { key: 'city',    label: 'City',                active: false, disabledReason: 'Set your city in profile to unlock', icon: '🏙️' },
              { key: 'community', label: 'My community',          href: scopeUrl('community'), active: scopeActive('community'), icon: '👥' },
            ]}
          />
        </div>

        {/* Community empty-state nudge — shown when viewer has no friends yet */}
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
                Invite friends to see their tournament picks alongside yours.
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

        <LeaderboardSearch
          initialQuery={searchTerm}
          baseQuery={baseQuery}
          basePath={basePath}
          scopeLabel={
            scope === 'community' ? 'in your community' :
            scope === 'city'      ? `in ${scopeCity ?? 'your city'}` :
            scope === 'country'   ? `in ${scopeCountry ?? 'your country'}` :
            'in this tournament'
          }
        />

        <TournamentResultsTable
          tournament={tournamentInfo}
          players={players}
          emptyTitle={isSearching ? 'No players found' : undefined}
          emptyHint={isSearching ? `No username matching “${searchTerm}” entered this tournament.` : undefined}
        />

        {!isSearching && (
          <Pagination page={page} totalPages={totalPages} baseQuery={baseQuery} basePath={basePath} />
        )}

        <p className="mt-4 text-center" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {isSearching
            ? players.length === 0
              ? `No matches for “${searchTerm}”`
              : `${players.length}${players.length === SEARCH_LIMIT ? '+' : ''} match${players.length === 1 ? '' : 'es'} for “${searchTerm}” · Ranks are positions in this tournament`
            : players.length === 0
              ? total === 0
                ? 'Points update after each result'
                : `No entrants on page ${page} · ${total} in total`
              : scope === 'community'
                ? `You and ${communityCount} friend${communityCount === 1 ? '' : 's'} · Points update after each result`
                : `Showing ${from + 1}–${from + players.length} of ${total} entrants · Points update after each result`}
        </p>
      </div>
    </main>
  )
}
