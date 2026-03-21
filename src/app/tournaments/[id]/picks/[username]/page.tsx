import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import BracketPredictor from '../../predict/BracketPredictor'

export default async function UserPicksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; username: string }>
  searchParams: Promise<{ challenge?: string }>
}) {
  const { id, username } = await params
  const { challenge: challengeId } = await searchParams

  // Get current viewer for access control
  const userClient = await createClient()
  const { data: { user: viewer } } = await userClient.auth.getUser()

  const supabase = createAdminClient()

  const [{ data: tournament }, { data: draw }, { data: targetUser }] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', id).single(),
    supabase.from('draws').select('bracket_data').eq('tournament_id', id).single(),
    supabase.from('users').select('id, username').eq('username', username).single(),
  ])

  if (!tournament || !draw?.bracket_data) notFound()
  if (!targetUser) notFound()

  // Load challenge-specific or global prediction
  let predQuery = supabase
    .from('predictions')
    .select('id, picks, is_fully_locked, points_earned')
    .eq('tournament_id', id)
    .eq('user_id', targetUser.id)

  if (challengeId) {
    predQuery = predQuery.eq('challenge_id', challengeId)
  } else {
    predQuery = predQuery.is('challenge_id', null)
  }

  const { data: prediction } = await predQuery.single()

  // Security: don't expose unlocked picks to other users
  const isOwnPicks = viewer?.id === targetUser.id
  if (prediction && !prediction.is_fully_locked && !isOwnPicks) {
    notFound()
  }

  // Fetch match results for color coding + per-match points
  const [{ data: results }, { data: pointRows }] = await Promise.all([
    supabase
      .from('match_results')
      .select('external_match_id, winner_external_id')
      .eq('tournament_id', id),
    supabase
      .from('point_ledger')
      .select('points, streak_multiplier, match_results(external_match_id)')
      .eq('user_id', targetUser.id)
      .eq('tournament_id', id),
  ])

  const matchResults: Record<string, string> = Object.fromEntries(
    (results ?? []).map(r => [r.external_match_id, r.winner_external_id])
  )

  const matchPoints: Record<string, { points: number; streakMultiplier: number }> = Object.fromEntries(
    (pointRows ?? [])
      .filter((r: any) => r.match_results?.external_match_id)
      .map((r: any) => [
        r.match_results.external_match_id,
        { points: r.points, streakMultiplier: r.streak_multiplier ?? 1 },
      ])
  )

  if (!prediction) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--chalk)' }}>
        <div className="text-center px-8 py-16">
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--ink)', marginBottom: '0.5rem' }}>
            No picks found
          </p>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            {username} hasn&apos;t submitted predictions for this {challengeId ? 'challenge' : 'tournament'}.
          </p>
        </div>
      </main>
    )
  }

  return (
    <BracketPredictor
      tournament={tournament}
      draw={draw.bracket_data as any}
      existingPicks={(prediction.picks as Record<string, string>) ?? {}}
      predictionId={prediction.id}
      username={username}
      returnUrl={challengeId ? `/challenges/${challengeId}` : `/tournaments/${id}`}
      matchResults={matchResults}
      matchPoints={matchPoints}
      readOnly
    />
  )
}
