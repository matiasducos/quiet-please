import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import LeaderboardTable from './LeaderboardTable'
import LeaderboardSelector from './LeaderboardSelector'
import ScopeSegmented from './ScopeSegmented'
import CountryFlag from '@/components/CountryFlag'
import { formatPoints } from '@/lib/utils/format'

export const metadata: Metadata = { title: 'Leaderboard | Quiet Please' }

type Scope   = 'worldwide' | 'country' | 'city' | 'community'
type Circuit = 'both' | 'atp' | 'wta'

type BreakdownEntry = {
  tournament_id: string
  name: string
  tour: string
  points: number
  flag: string | null
  totalPicks?: number
  correctPicks?: number
  streakPower?: number
}
type UserStats = {
  tournaments: number
  totalPicks: number
  correctPicks: number
  streakPower: number
}

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
  for (const p of userPredictions) {
    const t = p.tournaments as any
    if (!t?.name) continue
    const entry: BreakdownEntry = {
      tournament_id: p.tournament_id,
      name: t.location ?? t.name,
      tour: t.tour ?? '',
      points: p.points_earned ?? 0,
      flag: t.flag_emoji ?? null,
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
  const { data: allPreds } = await supabase
    .from('predictions')
    .select('id, user_id, tournament_id, picks')
    .in('user_id', userIds)
    .is('challenge_id', null)

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

  for (let i = 0; i < globalPredIds.length; i += 200) {
    const chunk = globalPredIds.slice(i, i + 200)
    const { data: ledgerData } = await supabase
      .from('point_ledger')
      .select('user_id, tournament_id, points, streak_multiplier')
      .in('prediction_id', chunk)

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

// User-specific community leaderboard: fetches the accepted-friend graph for
// `userId`, includes self, then builds the same breakdown/stats as the global
// view but limited to that set. Cache key includes userId so each user gets
// their own slot — the friend set is small (typically ≤ 50) so this is cheap.
function getCommunityLeaderboardData(userId: string, pointsField: string) {
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()

      // 1. Fetch accepted friend IDs (either side of the friendship).
      const { data: friendships } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)

      const friendIds = new Set<string>([userId])
      for (const f of friendships ?? []) {
        friendIds.add(f.requester_id === userId ? f.addressee_id : f.requester_id)
      }

      // 2. Fetch user rows, ordered by points.
      const { data: users } = await supabase
        .from('users')
        .select('id, username, ranking_points, atp_ranking_points, wta_ranking_points, country, city')
        .in('id', Array.from(friendIds))
        .not('username', 'is', null)
        .order(pointsField, { ascending: false })
        .limit(50)

      // 3. Build breakdown + stats — shared helper handles the per-user and
      //    per-(user, tournament) math.
      const userIds = (users ?? []).map(u => u.id)
      const { data: userPredictions } = userIds.length > 0
        ? await supabase.from('predictions')
            .select('user_id, tournament_id, points_earned, tournaments(name, tour, location, flag_emoji)')
            .in('user_id', userIds).is('challenge_id', null)
            .gt('points_earned', 0).order('points_earned', { ascending: false }).limit(500)
        : { data: [] as any[] }

      const { breakdownByUser, statsByUser } = await buildStats(supabase, userIds, userPredictions ?? [])

      const friendCount = friendIds.size - 1 // excluding self
      return { users: users ?? [], breakdownByUser, statsByUser, friendCount }
    },
    ['leaderboard-community', userId, pointsField],
    { revalidate: 60 }
  )()
}

// keyParts include all filter params so each combination gets its own cache slot
function getLeaderboardData(pointsField: string, scope: Scope, scopeCountry: string | null, scopeCity: string | null) {
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()
      let query = supabase
        .from('users')
        .select('id, username, ranking_points, atp_ranking_points, wta_ranking_points, country, city')
        .not('username', 'is', null)
        .order(pointsField, { ascending: false })
        .limit(50)
      if (scope === 'country' && scopeCountry) query = query.eq('country', scopeCountry)
      if (scope === 'city' && scopeCountry && scopeCity)
        query = query.eq('country', scopeCountry).eq('city', scopeCity)

      const { data: users } = await query

      const userIds = (users ?? []).map(u => u.id)
      const { data: userPredictions } = userIds.length > 0
        ? await supabase.from('predictions')
            .select('user_id, tournament_id, points_earned, tournaments(name, tour, location, flag_emoji)')
            .in('user_id', userIds).is('challenge_id', null)
            .gt('points_earned', 0).order('points_earned', { ascending: false }).limit(500)
        : { data: [] as any[] }

      const { breakdownByUser, statsByUser } = await buildStats(supabase, userIds, userPredictions ?? [])

      return { users: users ?? [], breakdownByUser, statsByUser }
    },
    ['leaderboard', pointsField, scope, scopeCountry ?? '_', scopeCity ?? '_'],
    { revalidate: 300 }
  )()
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; country?: string; city?: string; circuit?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Anonymous: show blurred leaderboard preview with signup overlay (FOMO, not a wall)
  if (!user) {
    const { users: previewUsers, breakdownByUser: previewBreakdown } = await getLeaderboardData('ranking_points', 'worldwide', null, null)
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
                users={(previewUsers ?? []).map(u => ({
                  id: u.id,
                  username: u.username,
                  country: u.country ?? null,
                  points: u.ranking_points as number,
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

  // ── Points field based on circuit ───────────────────────────────────────
  const pointsField =
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

  // ── Cached leaderboard data ────────────────────────────────────────────
  // Community scope: user-specific filter (self + accepted friends).
  // Worldwide/country/city: shared cache across all users in same view.
  let users: any[]
  let breakdownByUser: Record<string, any>
  let statsByUser: Record<string, any>
  let communityCount = 0
  if (scope === 'community') {
    const res = await getCommunityLeaderboardData(user.id, pointsField)
    users = res.users
    breakdownByUser = res.breakdownByUser
    statsByUser = res.statsByUser
    communityCount = res.friendCount
  } else {
    const res = await getLeaderboardData(pointsField, scope, scopeCountry, scopeCity)
    users = res.users
    breakdownByUser = res.breakdownByUser
    statsByUser = res.statsByUser
  }

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
  const myRankInList = users?.findIndex(u => u.id === user.id) ?? -1
  // If not in top 50, count how many in this scope have more points
  let myRank = myRankInList >= 0 ? myRankInList + 1 : null
  const myPoints = (profile as any)?.[pointsField] ?? 0

  // Community scope: self is always in the list, so we never fall into the
  // global-count fallback path (which wouldn't know how to scope anyway).
  if (myRankInList < 0 && scope !== 'community') {
    let countQuery = supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gt(pointsField, myPoints)
      .not('username', 'is', null)
    if (scope === 'country' && scopeCountry)
      countQuery = countQuery.eq('country', scopeCountry)
    if (scope === 'city' && scopeCountry && scopeCity)
      countQuery = countQuery.eq('country', scopeCountry).eq('city', scopeCity)
    const { count } = await countQuery
    myRank = (count ?? 0) + 1
  }

  // ── URL builders for tabs ────────────────────────────────────────────────
  function scopeUrl(s: Scope) {
    const params = new URLSearchParams()
    params.set('scope', s)
    if (circuit !== 'both') params.set('circuit', circuit)
    if (s === 'country' && profile?.country) params.set('country', profile.country)
    if (s === 'city' && profile?.country)    params.set('country', profile.country)
    if (s === 'city' && profile?.city)       params.set('city', profile.city)
    return `/leaderboard?${params.toString()}`
  }

  function circuitUrl(c: Circuit) {
    const params = new URLSearchParams()
    params.set('circuit', c)
    if (scope !== 'worldwide') params.set('scope', scope)
    if (scopeCountry)          params.set('country', scopeCountry)
    if (scopeCity)             params.set('city', scopeCity)
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

        {/* ── My rank highlight ──────────────────────────────────────────────── */}
        {myRank !== null && (
          <div className="mb-6 px-5 py-4 rounded-sm border" style={{ background: '#edf4fc', borderColor: '#b8d4f0' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#1e4e8c', minWidth: '32px' }}>
                  #{myRank}
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: '#1e4e8c' }}>
                  {profile?.username} (you)
                </span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#1e4e8c', fontWeight: 500 }}>
                {formatPoints(myPoints)} pts
              </span>
            </div>
            {myRankInList < 0 && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#4a7ab5', marginTop: '0.3rem' }}>
                Not shown in top 50
              </p>
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
          users={(users ?? []).map(u => ({
            id: u.id,
            username: u.username,
            country: u.country ?? null,
            points: (u as any)[pointsField] as number,
          }))}
          currentUserId={user.id}
          breakdownByUser={breakdownByUser}
          statsByUser={statsByUser}
          scope={scope}
        />

        <p className="mt-4 text-center" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {scope === 'community'
            ? `You and ${communityCount} friend${communityCount === 1 ? '' : 's'} · Rolling 52-week window · Points update after each result`
            : 'Showing up to 50 players · Rolling 52-week window · Points update after each result'}
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
