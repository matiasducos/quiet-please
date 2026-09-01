import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import { gateRedirect } from '@/lib/auth-redirect'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { PAST_CHALLENGE_STATUSES } from '@/lib/challenges/status'
import ChallengeRow, { type ChallengeRowData } from '../ChallengeRow'

export default async function PastChallengesPage() {
  const { user, profile } = await getNavProfile()
  if (!user) redirect(gateRedirect('/challenges/past'))

  const admin = createAdminClient()

  const { data: rawChallenges } = await admin
    .from('challenges')
    .select('id, challenger_id, challenged_id, tournament_id, status, scope_round, challenger_points, challenged_points, winner_id, created_at')
    .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
    .in('status', PAST_CHALLENGE_STATUSES as readonly string[])
    .order('created_at', { ascending: false })

  const tournamentIds = [...new Set((rawChallenges ?? []).map(c => c.tournament_id))]
  const userIds = [...new Set((rawChallenges ?? []).flatMap(c => [c.challenger_id, c.challenged_id]))]

  const [tournamentsRes, usersRes] = await Promise.all([
    tournamentIds.length > 0
      ? admin.from('tournaments').select('id, name, status, location, flag_emoji').in('id', tournamentIds)
      : Promise.resolve({ data: [] as any[] }),
    userIds.length > 0
      ? admin.from('users').select('id, username').in('id', userIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const tournamentMap = Object.fromEntries((tournamentsRes.data ?? []).map((t: any) => [t.id, { name: t.name, status: t.status, location: t.location, flag_emoji: t.flag_emoji }]))
  const usernameMap = Object.fromEntries((usersRes.data ?? []).map((u: any) => [u.id, u.username]))

  const challenges: ChallengeRowData[] = (rawChallenges ?? []).map(c => {
    const isChallenger = c.challenger_id === user.id
    return {
      id: c.id,
      status: c.status,
      scope_round: c.scope_round,
      created_at: c.created_at,
      isChallenger,
      opponentName: (isChallenger ? usernameMap[c.challenged_id] : usernameMap[c.challenger_id]) ?? null,
      isWinner: c.winner_id === user.id,
      isDraw: c.status === 'completed' && c.winner_id === null,
      myPoints:    (isChallenger ? c.challenger_points : c.challenged_points) ?? 0,
      theirPoints: (isChallenger ? c.challenged_points : c.challenger_points) ?? 0,
      // Every row here is finished, so nothing is waiting on the reader.
      myPicksOutstanding: false,
      tournament: tournamentMap[c.tournament_id] ?? { name: 'Unknown', location: null, flag_emoji: null },
    }
  })

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" userId={user.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/challenges" style={{ color: 'var(--muted)' }}>Challenges</Link>
          <span>/</span>
          <span>Past challenges</span>
        </div>

        <h1 className="mb-6" style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em' }}>
          Past challenges
        </h1>

        {challenges.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>No past challenges yet.</p>
        ) : (
          <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
            {challenges.map(c => <ChallengeRow key={c.id} c={c} />)}
          </div>
        )}
      </div>
    </main>
  )
}
