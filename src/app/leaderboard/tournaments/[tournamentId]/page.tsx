import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentResultsTable from '@/components/TournamentResultsTable'
import type { TournamentInfo, PlayerResult } from '@/components/TournamentResultsTable'
import LeaderboardSelector from '../../LeaderboardSelector'

export default async function GlobalTournamentResultsPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const { tournamentId } = await params
  const admin = createAdminClient()

  // Fetch tournament + active tournaments for selector in parallel
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: tournament }, { data: predictions }, { data: selectorTournaments }] = await Promise.all([
    admin.from('tournaments')
      .select('id, name, tour, category, surface, location, flag_emoji, starts_at, ends_at, status')
      .eq('id', tournamentId)
      .single(),
    // Fetch all global predictions for this tournament (top 50 — include 0-point users)
    admin.from('predictions')
      .select('id, user_id, points_earned, picks, users(username, country)')
      .eq('tournament_id', tournamentId)
      .is('challenge_id', null)
      .order('points_earned', { ascending: false })
      .limit(50),
    admin.from('tournaments')
      .select('id, name, location, flag_emoji, tour, status, starts_at')
      .or(`status.in.(accepting_predictions,in_progress),and(status.eq.completed,ends_at.gt.${fourteenDaysAgo})`)
      .order('starts_at', { ascending: false })
      .limit(20),
  ])

  if (!tournament) notFound()

  const userIds = (predictions ?? []).map((p: any) => p.user_id)

  // Count correct picks per user from point_ledger (only rows for GLOBAL predictions)
  const globalPredIds = (predictions ?? []).map((p: any) => p.id).filter(Boolean)
  const correctPicksByUser: Record<string, number> = {}
  if (globalPredIds.length > 0) {
    const { data: ledgerRows } = await admin.from('point_ledger')
      .select('user_id')
      .in('prediction_id', globalPredIds)
      .gt('points', 0)
    for (const row of ledgerRows ?? []) {
      correctPicksByUser[row.user_id] = (correctPicksByUser[row.user_id] ?? 0) + 1
    }
  }

  const players: PlayerResult[] = (predictions ?? []).map((p: any) => ({
    user_id: p.user_id,
    username: p.users?.username ?? 'Unknown',
    country: p.users?.country ?? null,
    points: p.points_earned ?? 0,
    correct_picks: correctPicksByUser[p.user_id] ?? 0,
    total_picks: Object.keys(p.picks ?? {}).length,
    isMe: p.user_id === user.id,
  }))

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
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leaderboard" userId={user.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        {/* Tournament selector dropdown */}
        <div className="mb-4">
          <LeaderboardSelector
            tournaments={(selectorTournaments ?? []).map(t => ({
              id: t.id, name: t.name, location: t.location ?? null,
              flag_emoji: t.flag_emoji ?? null, tour: t.tour, status: t.status,
            }))}
            currentTournamentId={tournamentId}
          />
        </div>

        <TournamentResultsTable tournament={tournamentInfo} players={players} />

        <p className="mt-4 text-center" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Showing top 50 · Points update after each result
        </p>
      </div>
    </main>
  )
}
