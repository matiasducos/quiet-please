import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import InviteCodeCard from './InviteCodeCard'
import LeagueLeaderboard from './LeagueLeaderboard'
import TournamentCard from '@/components/TournamentCard'

const TYPE_LABELS: Record<string, string> = {
  grand_slam: 'Grand Slams',
  masters_1000: 'Masters 1000',
  '500': '500s',
  '250': '250s',
}

const ACTIVITY_PREVIEW_LIMIT = 15

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

export default async function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const { id } = await params
  const supabase = await createClient()

  // ── Parallel fetch: league, membership, members ─────────────────────────
  const [leagueRes, membershipRes, membersRes] = await Promise.all([
    supabase.from('leagues').select('*').eq('id', id).single(),
    supabase.from('league_members').select('total_points').eq('league_id', id).eq('user_id', user.id).single(),
    supabase.from('league_members').select('user_id, total_points, joined_at, users(username)').eq('league_id', id).order('total_points', { ascending: false }),
  ])

  if (leagueRes.error) console.error('[league] fetch error:', leagueRes.error)
  if (membershipRes.error) console.error('[league] membership error:', membershipRes.error)
  if (membersRes.error) console.error('[league] members error:', membersRes.error)

  const league = leagueRes.data
  const myMembership = membershipRes.data
  const members = membersRes.data

  if (!league) notFound()
  if (!myMembership) redirect('/leagues')

  const isOwner = league.owner_id === user.id
  const myRank = (members ?? []).findIndex(m => m.user_id === user.id)

  // Activity feed — needs admin client to bypass RLS on other users' rows
  const memberIds = (members ?? []).map(m => m.user_id)
  const admin = createAdminClient()

  // ── Fetch points breakdown per member (for expandable rows) ─────────────
  let breakdownByUser: Record<string, Array<{ tournament_id: string; name: string; tour: string; points: number; flag: string | null }>> = {}
  if (memberIds.length > 0) {
    const { data: userPredictions } = await admin
      .from('predictions')
      .select('user_id, tournament_id, points_earned, tournaments(name, tour, location, flag_emoji)')
      .in('user_id', memberIds)
      .is('challenge_id', null)
      .gt('points_earned', 0)
      .order('points_earned', { ascending: false })
      .limit(500)

    for (const p of userPredictions ?? []) {
      const t = p.tournaments as any
      if (!t?.name) continue
      if (!breakdownByUser[p.user_id]) breakdownByUser[p.user_id] = []
      breakdownByUser[p.user_id].push({
        tournament_id: p.tournament_id,
        name: t.location ?? t.name,
        tour: t.tour ?? '',
        points: p.points_earned ?? 0,
        flag: t.flag_emoji ?? null,
      })
    }
  }

  // ── Fetch tournaments where members participated (for Tournaments section) ──
  let leagueTournaments: Array<{ id: string; name: string; tour: string; category: string; surface: string | null; location: string | null; flag_emoji: string | null; starts_at: string | null; ends_at: string | null; status: string }> = []
  if (memberIds.length > 0) {
    // Get tournament IDs from all member predictions
    const { data: memberPreds } = await admin
      .from('predictions')
      .select('tournament_id')
      .in('user_id', memberIds)
      .is('challenge_id', null)

    const tournamentIds = Array.from(new Set((memberPreds ?? []).map(p => p.tournament_id)))
    if (tournamentIds.length > 0) {
      const { data: tournaments } = await admin
        .from('tournaments')
        .select('id, name, tour, category, surface, location, flag_emoji, starts_at, ends_at, status')
        .in('id', tournamentIds)
        .order('starts_at', { ascending: false })

      leagueTournaments = (tournaments ?? []).filter(t => {
        // Filter to "this season" — tournaments that started within the last 52 weeks
        if (!t.starts_at) return false
        const weekAgo52 = new Date()
        weekAgo52.setDate(weekAgo52.getDate() - 364)
        return new Date(t.starts_at) >= weekAgo52
      })

      // Respect league tournament type filter
      const allowedTypes = league.allowed_tournament_types as string[] | null
      if (allowedTypes) {
        leagueTournaments = leagueTournaments.filter(t => allowedTypes.includes(t.category))
      }
    }
  }

  // Prepare leaderboard data for client component
  const leaderboardMembers = (members ?? []).map(m => ({
    user_id: m.user_id,
    username: (m.users as any)?.username ?? 'Unknown',
    total_points: m.total_points,
    isMe: m.user_id === user.id,
    isLeagueOwner: m.user_id === league.owner_id,
    breakdown: breakdownByUser[m.user_id] ?? [],
  }))

  type ActivityItem = {
    type: 'join' | 'picks' | 'points'
    user_id: string
    username: string
    label: string
    date: string
  }

  let activityItems: ActivityItem[] = []

  if (memberIds.length > 0) {
    const [{ data: lockedPicks }, { data: pointsRows }] = await Promise.all([
      admin
        .from('predictions')
        .select('user_id, tournament_id, submitted_at, users(username), tournaments(name, location)')
        .in('user_id', memberIds)
        .eq('is_fully_locked', true)
        .is('challenge_id', null)
        .order('submitted_at', { ascending: false })
        .limit(50),
      admin
        .from('point_ledger')
        .select('user_id, tournament_id, points, awarded_at, users(username), tournaments(name, location)')
        .in('user_id', memberIds)
        .order('awarded_at', { ascending: false })
        .limit(100),
    ])

    const joinEvents: ActivityItem[] = (members ?? []).map(m => ({
      type: 'join',
      user_id: m.user_id,
      username: (m.users as any)?.username ?? 'Unknown',
      label: 'joined the league',
      date: m.joined_at,
    }))

    const picksEvents: ActivityItem[] = (lockedPicks ?? []).map((p: any) => ({
      type: 'picks',
      user_id: p.user_id,
      username: p.users?.username ?? 'Unknown',
      label: `locked picks for ${p.tournaments?.location ?? p.tournaments?.name ?? 'a tournament'}`,
      date: p.submitted_at,
    }))

    const pointsMap = new Map<string, { user_id: string; username: string; points: number; tournament_name: string; awarded_at: string }>()
    for (const row of (pointsRows ?? []) as any[]) {
      const key = `${row.user_id}:${row.tournament_id}`
      const existing = pointsMap.get(key)
      if (existing) {
        existing.points += row.points
        if (row.awarded_at > existing.awarded_at) existing.awarded_at = row.awarded_at
      } else {
        pointsMap.set(key, {
          user_id: row.user_id,
          username: row.users?.username ?? 'Unknown',
          points: row.points,
          tournament_name: row.tournaments?.location ?? row.tournaments?.name ?? 'a tournament',
          awarded_at: row.awarded_at,
        })
      }
    }
    const pointsEvents: ActivityItem[] = Array.from(pointsMap.values()).map(p => ({
      type: 'points',
      user_id: p.user_id,
      username: p.username,
      label: `earned ${p.points} pts at ${p.tournament_name}`,
      date: p.awarded_at,
    }))

    activityItems = [...joinEvents, ...picksEvents, ...pointsEvents]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }

  const hasMoreActivity = activityItems.length > ACTIVITY_PREVIEW_LIMIT
  const displayedActivity = activityItems.slice(0, ACTIVITY_PREVIEW_LIMIT)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leagues" />

      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/leagues" style={{ color: 'var(--muted)' }}>Leagues</Link>
          <span>/</span>
          <span>{league.name}</span>
        </div>

        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-2">
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{league.name}</h1>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: league.is_public ? '#1e4e8c' : 'var(--muted)', background: league.is_public ? '#edf4fc' : 'var(--chalk-dim)', padding: '2px 8px', borderRadius: '2px', marginTop: '6px' }}>
                {league.is_public ? '🌐 Public' : '🔒 Private'}
              </span>
              <Link
                href={`/leagues/${id}/settings`}
                className="transition-opacity hover:opacity-70"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', textDecoration: 'none', marginTop: '6px' }}
              >
                {isOwner ? 'Edit settings' : 'Settings'}
              </Link>
            </div>
            {league.description && <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>{league.description}</p>}
            {league.allowed_tournament_types && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#1e4e8c', marginTop: '0.4rem' }}>
                Counting: {(league.allowed_tournament_types as string[]).map(t => TYPE_LABELS[t] ?? t).join(', ')}
              </p>
            )}
          </div>
          {!league.is_public && (
            <div className="flex flex-col items-end gap-2">
              <InviteCodeCard code={league.invite_code} />
            </div>
          )}
        </div>

        {/* My rank highlight */}
        {myRank >= 0 && (
          <div className="mb-6 px-5 py-4 rounded-sm border" style={{ background: '#edf4fc', borderColor: '#b8d4f0' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#1e4e8c', minWidth: '32px' }}>#{myRank + 1}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: '#1e4e8c' }}>{profile?.username} (you)</span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#1e4e8c' }}>{myMembership.total_points} pts</span>
            </div>
          </div>
        )}

        {/* Members leaderboard (expandable) */}
        <LeagueLeaderboard members={leaderboardMembers} leagueId={id} />

        {/* Tournaments */}
        {leagueTournaments.length > 0 && (
          <div className="mt-10">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
              Tournaments
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {leagueTournaments.map(t => (
                <div key={t.id} className="relative">
                  <TournamentCard t={t} />
                  <Link
                    href={`/leagues/${id}/tournaments/${t.id}`}
                    className="absolute bottom-3 right-4 px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-80"
                    style={{ background: 'var(--court)', color: 'white', textDecoration: 'none', zIndex: 1 }}
                  >
                    See results
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activity feed */}
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>
              Recent activity
            </h2>
            {hasMoreActivity && (
              <Link
                href={`/leagues/${id}/activity`}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--court)', textDecoration: 'none' }}
                className="transition-opacity hover:opacity-70"
              >
                See all
              </Link>
            )}
          </div>

          {displayedActivity.length === 0 ? (
            <div className="bg-white rounded-sm border py-10 px-6 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>No activity yet. Invite friends and start predicting!</p>
            </div>
          ) : (
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {displayedActivity.map((item, i) => {
                const isMe = item.user_id === user.id
                const icon = item.type === 'join' ? '👋' : item.type === 'picks' ? '🔒' : '⭐'
                return (
                  <div
                    key={`${item.type}-${item.user_id}-${item.date}-${i}`}
                    className="flex items-center gap-3 px-5 py-3 border-b last:border-0"
                    style={{ borderColor: 'var(--chalk-dim)' }}
                  >
                    <span style={{ fontSize: '1rem', flexShrink: 0 }}>{icon}</span>
                    <div className="flex-1 min-w-0">
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: isMe ? 'var(--court)' : 'var(--ink)' }}>
                        <Link href={`/profile/${item.username}`} style={{ color: 'inherit', textDecoration: 'none' }}>{item.username}</Link>
                      </span>
                      <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}> {item.label}</span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>
                      {timeAgo(item.date)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </main>
  )
}
