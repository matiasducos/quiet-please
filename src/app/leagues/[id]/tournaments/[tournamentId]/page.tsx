import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentResultsTable from '@/components/TournamentResultsTable'
import type { TournamentInfo, PlayerResult } from '@/components/TournamentResultsTable'
import LeagueTournamentSelector from '../../LeagueTournamentSelector'

export default async function LeagueTournamentResultsPage({ params }: { params: Promise<{ id: string; tournamentId: string }> }) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const { id: leagueId, tournamentId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  // Verify membership + fetch league and tournament in parallel
  const [{ data: league }, { data: myMembership }, { data: tournament }] = await Promise.all([
    supabase.from('leagues').select('id, name, season_start_date, created_at, allowed_tournament_types, allowed_surfaces').eq('id', leagueId).single(),
    supabase.from('league_members').select('league_id').eq('league_id', leagueId).eq('user_id', user.id).single(),
    admin.from('tournaments').select('id, name, tour, category, surface, location, flag_emoji, starts_at, ends_at, status').eq('id', tournamentId).single(),
  ])

  if (!league || !myMembership) redirect('/leagues')
  if (!tournament) notFound()

  // Get league member IDs + their tournament predictions for the selector
  const { data: members } = await admin
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId)

  const memberIds = (members ?? []).map(m => m.user_id)

  // Fetch predictions for this tournament by league members
  const { data: predictions } = memberIds.length > 0
    ? await admin.from('predictions')
        .select('id, user_id, points_earned, picks, users(username)')
        .eq('tournament_id', tournamentId)
        .is('challenge_id', null)
        .in('user_id', memberIds)
    : { data: [] as any[] }

  // Count correct picks + streak power per user from point_ledger (GLOBAL predictions only)
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

  // Fetch all league tournament IDs for the selector dropdown
  const { data: memberPreds } = memberIds.length > 0
    ? await admin.from('predictions')
        .select('tournament_id')
        .in('user_id', memberIds)
        .is('challenge_id', null)
    : { data: [] as any[] }

  const selectorTournamentIds = Array.from(new Set((memberPreds ?? []).map(p => p.tournament_id)))
  let selectorTournaments: Array<{ id: string; name: string; tour: string; location: string | null; flag_emoji: string | null; status: string; starts_at: string | null }> = []
  if (selectorTournamentIds.length > 0) {
    const { data: allTournaments } = await admin
      .from('tournaments')
      .select('id, name, tour, category, surface, location, flag_emoji, starts_at, status')
      .in('id', selectorTournamentIds)
      .order('starts_at', { ascending: false })

    // Apply season boundary + league filters
    const seasonStart = league.season_start_date ? new Date(league.season_start_date as string) : new Date(league.created_at)
    const weekAgo52 = new Date()
    weekAgo52.setDate(weekAgo52.getDate() - 364)
    const boundary = seasonStart > weekAgo52 ? seasonStart : weekAgo52
    const allowedTypes = league.allowed_tournament_types as string[] | null
    const allowedSurfaces = league.allowed_surfaces as string[] | null

    selectorTournaments = (allTournaments ?? []).filter(t => {
      if (!t.starts_at || new Date(t.starts_at) < boundary) return false
      if (allowedTypes && !allowedTypes.includes(t.category)) return false
      if (allowedSurfaces && (!t.surface || !allowedSurfaces.includes(t.surface))) return false
      return true
    })
  }

  // Build player results
  const players: PlayerResult[] = (predictions ?? [])
    .filter((p: any) => p.points_earned > 0 || Object.keys(p.picks ?? {}).length > 0)
    .map((p: any) => {
      const acc = streakAccumByUser[p.user_id]
      return {
        user_id: p.user_id,
        username: p.users?.username ?? 'Unknown',
        points: p.points_earned ?? 0,
        correct_picks: correctPicksByUser[p.user_id] ?? 0,
        total_picks: Object.keys(p.picks ?? {}).length,
        streak_power: acc && acc.basePts > 0 ? acc.totalPts / acc.basePts : 1,
        isMe: p.user_id === user.id,
      }
    })
    .sort((a: PlayerResult, b: PlayerResult) => b.points - a.points)

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

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leagues" />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/leagues" style={{ color: 'var(--muted)' }}>Leagues</Link>
          <span>/</span>
          <Link href={`/leagues/${leagueId}`} style={{ color: 'var(--muted)' }}>{league.name}</Link>
          <span>/</span>
          <span>{tournament.location ?? tournament.name}</span>
        </div>

        {/* Tournament selector dropdown */}
        {selectorTournaments.length > 0 && (
          <div className="mb-4">
            <LeagueTournamentSelector
              tournaments={selectorTournaments.map(t => ({
                id: t.id,
                name: t.name,
                location: t.location,
                flag_emoji: t.flag_emoji,
                tour: t.tour,
                status: t.status,
              }))}
              leagueId={leagueId}
              currentTournamentId={tournamentId}
            />
          </div>
        )}

        <TournamentResultsTable tournament={tournamentInfo} players={players} />
      </div>
    </main>
  )
}
