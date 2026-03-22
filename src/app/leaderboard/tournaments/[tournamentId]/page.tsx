import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentResultsTable from '@/components/TournamentResultsTable'
import type { TournamentInfo, PlayerResult } from '@/components/TournamentResultsTable'

export default async function GlobalTournamentResultsPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const { tournamentId } = await params
  const admin = createAdminClient()

  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, name, tour, category, surface, location, flag_emoji, starts_at, ends_at, status')
    .eq('id', tournamentId)
    .single()

  if (!tournament) notFound()

  // Fetch all global predictions for this tournament (top 50 by points)
  const { data: predictions } = await admin
    .from('predictions')
    .select('user_id, points_earned, picks, users(username)')
    .eq('tournament_id', tournamentId)
    .is('challenge_id', null)
    .gt('points_earned', 0)
    .order('points_earned', { ascending: false })
    .limit(50)

  const userIds = (predictions ?? []).map((p: any) => p.user_id)

  // Count correct picks per user from point_ledger
  const { data: ledgerRows } = userIds.length > 0
    ? await admin.from('point_ledger')
        .select('user_id')
        .eq('tournament_id', tournamentId)
        .in('user_id', userIds)
    : { data: [] as any[] }

  const correctPicksByUser: Record<string, number> = {}
  for (const row of ledgerRows ?? []) {
    correctPicksByUser[row.user_id] = (correctPicksByUser[row.user_id] ?? 0) + 1
  }

  const players: PlayerResult[] = (predictions ?? []).map((p: any) => ({
    user_id: p.user_id,
    username: p.users?.username ?? 'Unknown',
    points: p.points_earned ?? 0,
    correct_picks: correctPicksByUser[p.user_id] ?? 0,
    total_picks: Object.keys(p.picks ?? {}).length,
    isMe: p.user_id === user.id,
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

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leaderboard" userId={user.id} />

      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/leaderboard" style={{ color: 'var(--muted)' }}>Leaderboard</Link>
          <span>/</span>
          <span>{tournament.location ?? tournament.name}</span>
        </div>

        <TournamentResultsTable tournament={tournamentInfo} players={players} />

        <p className="mt-4 text-center" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Showing top 50 · Points update after each result
        </p>
      </div>
    </main>
  )
}
