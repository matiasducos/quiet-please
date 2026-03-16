import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import BracketPredictor from '../../predict/BracketPredictor'

export default async function UserPicksPage({
  params,
}: {
  params: Promise<{ id: string; username: string }>
}) {
  const { id, username } = await params
  const supabase = createAdminClient()

  const [{ data: tournament }, { data: draw }, { data: targetUser }] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', id).single(),
    supabase.from('draws').select('bracket_data').eq('tournament_id', id).single(),
    supabase.from('users').select('id, username').eq('username', username).single(),
  ])

  if (!tournament || !draw?.bracket_data) notFound()
  if (!targetUser) notFound()

  const { data: prediction } = await supabase
    .from('predictions')
    .select('id, picks, is_locked, is_practice, points_earned')
    .eq('tournament_id', id)
    .eq('user_id', targetUser.id)
    .eq('is_locked', true)
    .eq('is_practice', false)
    .single()

  // Fetch match results for color coding
  const { data: results } = await supabase
    .from('match_results')
    .select('external_match_id, winner_external_id')
    .eq('tournament_id', id)

  const matchResults: Record<string, string> = Object.fromEntries(
    (results ?? []).map(r => [r.external_match_id, r.winner_external_id])
  )

  if (!prediction) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--chalk)' }}>
        <div className="text-center px-8 py-16">
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--ink)', marginBottom: '0.5rem' }}>
            No picks found
          </p>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            {username} hasn&apos;t submitted predictions for this tournament.
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
      returnUrl={`/tournaments/${id}`}
      matchResults={matchResults}
      readOnly
    />
  )
}
