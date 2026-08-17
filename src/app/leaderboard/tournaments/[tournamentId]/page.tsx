import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentResultsTable from '@/components/TournamentResultsTable'
import type { TournamentInfo, PlayerResult } from '@/components/TournamentResultsTable'
import LeaderboardSelector from '../../LeaderboardSelector'
import LeaderboardSearch from '../../LeaderboardSearch'
import Pagination from '../../Pagination'
import ScopeSegmented from '../../ScopeSegmented'
import CountryFlag from '@/components/CountryFlag'
import { SITE_NAME } from '@/lib/site'
import { SEARCH_LIMIT, isSearchActive, sanitizeSearch } from '@/lib/utils/search'

type Scope = 'worldwide' | 'country' | 'city' | 'community'

const PAGE_SIZE = 50

/**
 * Rows behind the signed-out preview. Small on purpose: the overlay covers most
 * of the table anyway, and this query now runs for every crawler hit on every
 * tournament board.
 */
const PREVIEW_ROWS = 10

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Correct-pick counts and streak power per user, from the ledger rows attached
 * to a set of predictions.
 *
 * Shared by the signed-in board and the public preview so the preview never has
 * to invent the two numbers it cannot read off the prediction row — they end up
 * in crawlable HTML, and a table of fabricated zeroes is worse than no table.
 */
async function aggregateLedger(admin: AdminClient, predictionIds: string[]) {
  const correctPicksByUser: Record<string, number> = {}
  const streakAccumByUser: Record<string, { totalPts: number; basePts: number }> = {}
  if (predictionIds.length === 0) return { correctPicksByUser, streakAccumByUser }

  const { data: ledgerRows, error } = await admin.from('point_ledger')
    .select('user_id, points, streak_multiplier')
    .in('prediction_id', predictionIds)
    .gt('points', 0)
  if (error) console.error('[tournament-leaderboard] ledger query failed:', error.message)

  for (const row of ledgerRows ?? []) {
    correctPicksByUser[row.user_id] = (correctPicksByUser[row.user_id] ?? 0) + 1
    const pts  = row.points ?? 0
    const mult = row.streak_multiplier ?? 1
    if (!streakAccumByUser[row.user_id]) streakAccumByUser[row.user_id] = { totalPts: 0, basePts: 0 }
    streakAccumByUser[row.user_id].totalPts += pts
    streakAccumByUser[row.user_id].basePts  += pts / mult
  }
  return { correctPicksByUser, streakAccumByUser }
}

const streakPower = (acc?: { totalPts: number; basePts: number }) =>
  acc && acc.basePts > 0 ? acc.totalPts / acc.basePts : 1

/**
 * Name, year and the slug URL of the edition this board belongs to.
 *
 * The board itself lives on a uuid path, so the canonical has to point somewhere
 * else — see `generateMetadata`.
 */
async function fetchEditionIdentity(tournamentId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tournaments')
    .select('name, starts_year, tournament_series(slug, slug_reviewed)')
    .eq('id', tournamentId)
    .maybeSingle()

  if (error) {
    console.error('[tournament-leaderboard] identity lookup failed:', error.message)
    return null
  }
  if (!data) return null

  // PostgREST returns an embedded to-one either way depending on how it reads
  // the relationship; both shapes turn up in practice.
  const embedded = (data as { tournament_series?: unknown }).tournament_series as
    | { slug: string; slug_reviewed: boolean }
    | { slug: string; slug_reviewed: boolean }[]
    | null
    | undefined
  const series = Array.isArray(embedded) ? embedded[0] : embedded

  return {
    name: data.name,
    year: data.starts_year,
    // Unreviewed slugs are auto-created by the sync cron and stay noindex until
    // an admin confirms the URL, so canonicalising onto one would point at a
    // page that asks not to be indexed.
    editionPath:
      series?.slug && series.slug_reviewed && data.starts_year != null
        ? `/tournaments/${series.slug}/${data.starts_year}`
        : null,
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tournamentId: string }>
}): Promise<Metadata> {
  const { tournamentId } = await params
  const edition = await fetchEditionIdentity(tournamentId)

  // No row, or no reviewed slug to point at: crawlable but not indexable, so a
  // uuid URL never becomes the canonical version of anything.
  if (!edition?.editionPath) {
    return { title: 'Tournament leaderboard', robots: { index: false, follow: true } }
  }

  const label = edition.year ? `${edition.name} ${edition.year}` : edition.name

  return {
    title: `${label} leaderboard`,
    description:
      `Full standings for the ${label} bracket challenge on ${SITE_NAME} — every entrant, ` +
      `their score and their correct picks, updated after each result.`,
    /*
     * Canonical points at the edition page, not at this URL.
     *
     * These boards are reachable only at /leaderboard/tournaments/<uuid>, they
     * are linked from every edition page, and what they show is a subset of the
     * edition page's own content. Left to itself that mints ~95 indexable uuid
     * URLs competing with the slug URLs that are in the sitemap and already
     * rank. Consolidating hands their signals to the edition page instead.
     */
    alternates: { canonical: edition.editionPath },
  }
}

export default async function GlobalTournamentResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tournamentId: string }>
  searchParams: Promise<{ scope?: string; country?: string; city?: string; page?: string; q?: string }>
}) {
  const { user, profile } = await getNavProfile()

  const { tournamentId } = await params

  /*
   * Signed out: serve the board behind a preview, on a real 200.
   *
   * This branch used to `redirect(gateRedirect(...))`, which cannot emit a status
   * code from here. `leaderboard/loading.tsx` is a Suspense boundary above this
   * route, so the response shell flushes — committing 200 — before the redirect
   * branch runs, and Next degrades to `<meta http-equiv="refresh">`. Google
   * follows a meta refresh and files the URL under "Page with redirect"; because
   * every edition page links its board, and edition pages are in the sitemap,
   * roughly one URL per edition sat in that bucket permanently and made fix
   * validation in Search Console fail.
   *
   * Rendering is the fix for both halves of that: the status is honestly 200,
   * and an organic visitor lands on the thing they clicked instead of a wall.
   * See legacy-redirect.ts for the same flush behaviour diagnosed on /tournaments.
   */
  if (!user) return <PublicTournamentBoard tournamentId={tournamentId} />

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
  const { correctPicksByUser, streakAccumByUser } = await aggregateLedger(admin, globalPredIds)

  const players: PlayerResult[] = (predictions ?? []).map((p: any, i: number) => {
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
      streak_power: streakPower(streakAccumByUser[p.user_id]),
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

type PreviewRow = {
  id: string
  user_id: string
  points_earned: number | null
  picks: Record<string, unknown> | null
  users: { username: string | null; country: string | null } | null
}

/**
 * The signed-out view of a tournament board.
 *
 * Deliberately narrower than the signed-in page: worldwide scope only, first
 * rows only, no search and no pagination. Every one of those controls is a URL
 * a crawler would follow, and the scoped ones need a viewer to mean anything —
 * so leaving them out keeps the crawlable surface to exactly one URL per board.
 *
 * `tournamentInfo` is built WITHOUT `id`, and that is load-bearing rather than an
 * omission: TournamentResultsTable links its header to `/tournaments/<id>` and
 * each locked bracket to `/tournaments/<id>/picks/<username>`, both uuid paths
 * that 308 to their slug equivalents. Publishing them would recreate, on this
 * very page, the "Page with redirect" problem this branch exists to remove.
 * Without `id` the component renders a plain header and no picks links, and the
 * one internal link we do want — to the edition page — is spelled out below,
 * outside the blur, where it reads as real anchor text.
 */
async function PublicTournamentBoard({ tournamentId }: { tournamentId: string }) {
  const admin = createAdminClient()

  const [
    { data: tournament, error: tournamentError },
    { data: previewRows, count: entrantCount, error: previewError },
  ] = await Promise.all([
    admin.from('tournaments')
      .select('name, tour, category, surface, location, flag_emoji, starts_at, ends_at, status, starts_year, tournament_series(slug, slug_reviewed)')
      .eq('id', tournamentId)
      .maybeSingle(),
    admin.from('predictions')
      // challenge_id null: challenge brackets are separate entries and never
      // belong on a tournament board. `count` covers the whole board, not just
      // the rows fetched — PostgREST reports it alongside the limited page.
      .select('id, user_id, points_earned, picks, users(username, country)', { count: 'exact' })
      .eq('tournament_id', tournamentId)
      .is('challenge_id', null)
      .order('points_earned', { ascending: false })
      // Same tiebreak as the signed-in board: equal scores have no stable order
      // otherwise, and tournament boards cluster hard on a few point totals.
      .order('id', { ascending: true })
      .limit(PREVIEW_ROWS),
  ])

  if (tournamentError) {
    console.error('[tournament-leaderboard] preview tournament query failed:', tournamentError.message)
  }
  // Soft 404 rather than a real one: `leaderboard/loading.tsx` is a Suspense
  // boundary above this route, so the status is already committed by the time
  // this throws. `generateMetadata` sends noindex for a missing row, so nothing
  // gets indexed off the back of it.
  if (!tournament) notFound()
  if (previewError) {
    console.error('[tournament-leaderboard] preview board query failed:', previewError.message)
  }

  const rows = (previewRows ?? []) as unknown as PreviewRow[]
  const { correctPicksByUser, streakAccumByUser } = await aggregateLedger(admin, rows.map(r => r.id))

  const players: PlayerResult[] = rows.map((p, i) => ({
    rank: i + 1,
    user_id: p.user_id,
    username: p.users?.username ?? 'Unknown',
    country: p.users?.country ?? null,
    points: p.points_earned ?? 0,
    correct_picks: correctPicksByUser[p.user_id] ?? 0,
    total_picks: Object.keys(p.picks ?? {}).length,
    streak_power: streakPower(streakAccumByUser[p.user_id]),
    isMe: false,
  }))

  const tournamentInfo: TournamentInfo = {
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

  const embedded = (tournament as { tournament_series?: unknown }).tournament_series as
    | { slug: string; slug_reviewed: boolean }
    | { slug: string; slug_reviewed: boolean }[]
    | null
    | undefined
  const series = Array.isArray(embedded) ? embedded[0] : embedded
  const editionPath =
    series?.slug && series.slug_reviewed && tournament.starts_year != null
      ? `/tournaments/${series.slug}/${tournament.starts_year}`
      : null

  const label = tournament.starts_year ? `${tournament.name} ${tournament.starts_year}` : tournament.name
  const total = entrantCount ?? 0
  const isCompleted = tournament.status === 'completed'

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav activePage="leaderboard" />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {tournament.flag_emoji && <span style={{ marginRight: '10px' }}>{tournament.flag_emoji}</span>}
            {label} leaderboard
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: '0.4rem', lineHeight: 1.65 }}>
            {total > 0
              ? `${total} entrant${total === 1 ? '' : 's'} · ${isCompleted ? 'Final standings' : 'Points update after each result'}`
              : isCompleted
                ? 'This edition is in the archive'
                : 'Points update after each result'}
          </p>
          {editionPath && (
            <p style={{ marginTop: '0.75rem' }}>
              <Link
                href={editionPath}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--court)', letterSpacing: '0.03em' }}
              >
                See the full {label} draw and results →
              </Link>
            </p>
          )}
        </div>

        {/*
          Only gate a board that exists. The historical editions imported as
          evergreen inventory have no entrants at all, so blurring their empty
          table behind "sign up to see the full board" would promise something
          that is not there — and that is most of what a crawler reaches, since
          every edition page links its board.
        */}
        {players.length === 0 ? (
          <TournamentResultsTable
            tournament={tournamentInfo}
            players={players}
            emptyTitle={isCompleted ? 'No entrants for this edition' : 'No entrants yet'}
            emptyHint={
              isCompleted
                ? 'Nobody entered a bracket for this one. The draw and results are still on the tournament page.'
                : 'Be the first to enter a bracket for this tournament.'
            }
          />
        ) : (
          /* Blurred board + overlay — same soft-gate pattern as /leaderboard. */
          <div style={{ position: 'relative' }}>
            <div style={{ filter: 'blur(5px)', userSelect: 'none', pointerEvents: 'none' }} aria-hidden="true">
              <TournamentResultsTable tournament={tournamentInfo} players={players} />
            </div>

            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to bottom, transparent 0%, rgba(245,242,235,0.5) 30%, rgba(245,242,235,0.97) 60%)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'flex-end',
              paddingBottom: '40px',
            }}>
              <div className="text-center px-4">
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--ink)' }}>
                  Sign up to see the full board
                </p>
                <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.25rem', maxWidth: '26rem' }}>
                  Create a free account to enter your own bracket and see where you land against all {total} entrants.
                </p>
                <Link
                  href={`/signup?next=${encodeURIComponent(`/leaderboard/tournaments/${tournamentId}`)}`}
                  className="px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
                  style={{ background: 'var(--court)', textDecoration: 'none' }}
                >
                  Create account
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
