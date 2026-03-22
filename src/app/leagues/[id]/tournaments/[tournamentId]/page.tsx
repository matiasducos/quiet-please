import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentResultsTable from '@/components/TournamentResultsTable'
import type { TournamentInfo, PlayerResult } from '@/components/TournamentResultsTable'

export default async function LeagueTournamentResultsPage({ params }: { params: Promise<{ id: string; tournamentId: string }> }) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const { id: leagueId, tournamentId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  // Verify membership + fetch league and tournament in parallel
  const [{ data: league }, { data: myMembership }, { data: tournament }] = await Promise.all([
    supabase.from('leagues').select('id, name').eq('id', leagueId).single(),
    supabase.from('league_members').select('league_id').eq('league_id', leagueId).eq('user_id', user.id).single(),
    admin.from('tournaments').select('id, name, tour, category, surface, location, flag_emoji, starts_at, ends_at, status').eq('id', tournamentId).single(),
  ])

  if (!league || !myMembership) redirect('/leagues')
  if (!tournament) notFound()

  // Get league member IDs
  const { data: members } = await admin
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId)

  const memberIds = (members ?? []).map(m => m.user_id)

  // Fetch predictions for this tournament by league members
  const { data: predictions } = memberIds.length > 0
    ? await admin.from('predictions')
        .select('user_id, points_earned, picks, users(username)')
        .eq('tournament_id', tournamentId)
        .is('challenge_id', null)
        .in('user_id', memberIds)
    : { data: [] as any[] }

  // Count correct picks per user from point_ledger
  const { data: ledgerRows } = memberIds.length > 0
    ? await admin.from('point_ledger')
        .select('user_id')
        .eq('tournament_id', tournamentId)
        .in('user_id', memberIds)
    : { data: [] as any[] }

  const correctPicksByUser: Record<string, number> = {}
  for (const row of ledgerRows ?? []) {
    correctPicksByUser[row.user_id] = (correctPicksByUser[row.user_id] ?? 0) + 1
  }

  // Build player results
  const players: PlayerResult[] = (predictions ?? [])
    .filter((p: any) => p.points_earned > 0 || Object.keys(p.picks ?? {}).length > 0)
    .map((p: any) => ({
      user_id: p.user_id,
      username: p.users?.username ?? 'Unknown',
      points: p.points_earned ?? 0,
      correct_picks: correctPicksByUser[p.user_id] ?? 0,
      total_picks: Object.keys(p.picks ?? {}).length,
      isMe: p.user_id === user.id,
    }))
    .sort((a: PlayerResult, b: PlayerResult) => b.points - a.points)

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

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leagues" />

      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/leagues" style={{ color: 'var(--muted)' }}>Leagues</Link>
          <span>/</span>
          <Link href={`/leagues/${leagueId}`} style={{ color: 'var(--muted)' }}>{league.name}</Link>
          <span>/</span>
          <span>{tournament.location ?? tournament.name}</span>
        </div>

        <TournamentResultsTable tournament={tournamentInfo} players={players} />
      </div>
    </main>
  )
}
