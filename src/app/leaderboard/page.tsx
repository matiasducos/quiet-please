import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import LeaderboardTable from './LeaderboardTable'

type Scope   = 'worldwide' | 'country' | 'city'
type Circuit = 'both' | 'atp' | 'wta'

// Cache leaderboard data (same for all users in the same scope/circuit) — 5 min TTL
const getLeaderboardData = unstable_cache(
  async (pointsField: string, scope: Scope, scopeCountry: string | null, scopeCity: string | null) => {
    const supabase = createAdminClient()
    let query = supabase
      .from('users')
      .select('id, username, ranking_points, atp_ranking_points, wta_ranking_points, country, city')
      .gt(pointsField, 0)
      .order(pointsField, { ascending: false })
      .limit(50)
    if (scope === 'country' && scopeCountry) query = query.eq('country', scopeCountry)
    if (scope === 'city' && scopeCountry && scopeCity)
      query = query.eq('country', scopeCountry).eq('city', scopeCity)

    const { data: users } = await query

    const userIds = (users ?? []).map(u => u.id)
    const { data: userPredictions } = userIds.length > 0
      ? await supabase.from('predictions')
          .select('user_id, points_earned, tournaments(name, tour)')
          .in('user_id', userIds).is('challenge_id', null)
          .gt('points_earned', 0).order('points_earned', { ascending: false }).limit(500)
      : { data: [] as any[] }

    const breakdownByUser: Record<string, Array<{ name: string; tour: string; points: number }>> = {}
    for (const p of userPredictions ?? []) {
      const t = p.tournaments as any
      if (!t?.name) continue
      if (!breakdownByUser[p.user_id]) breakdownByUser[p.user_id] = []
      breakdownByUser[p.user_id].push({ name: t.name, tour: t.tour ?? '', points: p.points_earned ?? 0 })
    }

    return { users: users ?? [], breakdownByUser }
  },
  ['leaderboard'],
  { revalidate: 300 }  // 5 minutes
)

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; country?: string; city?: string; circuit?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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

  // ── Cached leaderboard data (shared across all users in same view) ─────
  const { users, breakdownByUser } = await getLeaderboardData(pointsField, scope, scopeCountry, scopeCity)

  // ── My rank: position in the current scope/circuit view ─────────────────
  const myRankInList = users?.findIndex(u => u.id === user.id) ?? -1
  // If not in top 50, count how many in this scope have more points
  let myRank = myRankInList >= 0 ? myRankInList + 1 : null
  const myPoints = (profile as any)?.[pointsField] ?? 0

  if (myRankInList < 0 && myPoints > 0) {
    let countQuery = supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gt(pointsField, myPoints)
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

        {/* ── Scope + Circuit controls ──────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">

          {/* Scope pills */}
          <div className="flex items-center gap-1.5">
            <ScopeBtn href={scopeUrl('worldwide')} active={scopeActive('worldwide')}>Worldwide</ScopeBtn>

            {profile?.country ? (
              <ScopeBtn href={scopeUrl('country')} active={scopeActive('country')}>
                {profile.country}
              </ScopeBtn>
            ) : (
              <ScopeBtnDisabled title="Set your country in profile to unlock">Country</ScopeBtnDisabled>
            )}

            {profile?.city ? (
              <ScopeBtn href={scopeUrl('city')} active={scopeActive('city')}>
                {profile.city}
              </ScopeBtn>
            ) : (
              <ScopeBtnDisabled title="Set your city in profile to unlock">City</ScopeBtnDisabled>
            )}
          </div>

          {/* Circuit pills */}
          <div className="flex items-center gap-1.5">
            <CircuitBtn href={circuitUrl('both')} active={circuitActive('both')}>Both</CircuitBtn>
            <CircuitBtn href={circuitUrl('atp')}  active={circuitActive('atp')}>ATP</CircuitBtn>
            <CircuitBtn href={circuitUrl('wta')}  active={circuitActive('wta')}>WTA</CircuitBtn>
          </div>
        </div>

        {/* ── My rank highlight ──────────────────────────────────────────────── */}
        {myRank !== null && myPoints > 0 && (
          <div className="mb-6 px-5 py-4 rounded-sm border" style={{ background: '#eaf3de', borderColor: '#97C459' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#27500A', minWidth: '32px' }}>
                  #{myRank}
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: '#27500A' }}>
                  {profile?.username} (you)
                </span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#27500A', fontWeight: 500 }}>
                {myPoints} pts
              </span>
            </div>
            {myRankInList < 0 && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#5a8a2a', marginTop: '0.3rem' }}>
                Not shown in top 50
              </p>
            )}
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
          scope={scope}
        />

        <p className="mt-4 text-center" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Showing top 50 · Rolling 52-week window · Points update after each result
        </p>

        {/* Profile nudge if location not set */}
        {!profile?.country && (
          <p className="mt-2 text-center" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            <Link href={`/profile/${profile?.username}`} style={{ color: 'var(--court)' }}>
              Set your country and city
            </Link>{' '}to unlock the country &amp; city leaderboards
          </p>
        )}
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

function ScopeBtn({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-xs rounded-sm border transition-colors whitespace-nowrap"
      style={{
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.03em',
        borderColor: active ? 'var(--court)' : 'var(--chalk-dim)',
        color: active ? 'var(--court)' : 'var(--muted)',
        background: active ? '#eaf3de' : 'white',
        fontWeight: active ? 600 : 400,
        textDecoration: 'none',
      }}
    >
      {children}
    </Link>
  )
}

function ScopeBtnDisabled({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <span
      title={title}
      className="px-3 py-1.5 text-xs rounded-sm border"
      style={{
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.03em',
        borderColor: 'var(--chalk-dim)',
        color: 'var(--chalk-dim)',
        background: 'white',
        cursor: 'not-allowed',
      }}
    >
      {children}
    </span>
  )
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
