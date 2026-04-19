import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentResultsTable from '@/components/TournamentResultsTable'
import type { TournamentInfo, PlayerResult } from '@/components/TournamentResultsTable'
import LeaderboardSelector from '../../LeaderboardSelector'
import ScopeSegmented from '../../ScopeSegmented'
import CountryFlag from '@/components/CountryFlag'

type Scope = 'worldwide' | 'country' | 'city' | 'community'

export default async function GlobalTournamentResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tournamentId: string }>
  searchParams: Promise<{ scope?: string; country?: string; city?: string }>
}) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const { tournamentId } = await params
  const sp = await searchParams
  const scope: Scope = (sp.scope as Scope | undefined) ?? 'worldwide'
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
  // The users join shape changes depending on scope:
  //   • worldwide/community → `users(username, country)` (filter applied
  //     separately: in-memory for community via user_id set)
  //   • country/city        → `users!inner(username, country, city)` + .eq()
  //     filters on the embedded columns
  let predQuery = admin
    .from('predictions')
    .select(
      scope === 'country' || scope === 'city'
        ? 'id, user_id, points_earned, picks, users!inner(username, country, city)'
        : 'id, user_id, points_earned, picks, users(username, country)',
    )
    .eq('tournament_id', tournamentId)
    .is('challenge_id', null)
    .order('points_earned', { ascending: false })
    .limit(50)

  if (scope === 'country' && scopeCountry) {
    predQuery = predQuery.eq('users.country', scopeCountry)
  } else if (scope === 'city' && scopeCountry && scopeCity) {
    predQuery = predQuery.eq('users.country', scopeCountry).eq('users.city', scopeCity)
  } else if (scope === 'community' && communityIds) {
    predQuery = predQuery.in('user_id', communityIds)
  }

  const { data: predictions } = await predQuery

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

  const players: PlayerResult[] = (predictions ?? []).map((p: any) => {
    const acc = streakAccumByUser[p.user_id]
    return {
      user_id: p.user_id,
      username: p.users?.username ?? 'Unknown',
      country: p.users?.country ?? null,
      points: p.points_earned ?? 0,
      correct_picks: correctPicksByUser[p.user_id] ?? 0,
      total_picks: Object.keys(p.picks ?? {}).length,
      streak_power: acc && acc.basePts > 0 ? acc.totalPts / acc.basePts : 1,
      isMe: p.user_id === user.id,
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

        <TournamentResultsTable tournament={tournamentInfo} players={players} />

        <p className="mt-4 text-center" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {scope === 'community'
            ? `You and ${communityCount} friend${communityCount === 1 ? '' : 's'} · Points update after each result`
            : 'Showing top 50 · Points update after each result'}
        </p>
      </div>
    </main>
  )
}
