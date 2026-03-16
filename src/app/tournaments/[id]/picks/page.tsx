import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import BracketPredictor from '../predict/BracketPredictor'

export default async function PicksPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { id } = await params

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', id)
    .single()

  if (!tournament) notFound()

  const { data: prediction } = await supabase
    .from('predictions')
    .select('id, picks, is_locked, is_practice')
    .eq('tournament_id', id)
    .eq('user_id', user.id)
    .single()

  // Only show picks view for locked predictions
  if (!prediction?.is_locked) redirect(`/tournaments/${id}`)

  const { data: draw } = await supabase
    .from('draws')
    .select('bracket_data')
    .eq('tournament_id', id)
    .single()

  if (!draw?.bracket_data) redirect(`/tournaments/${id}`)

  // Fetch match results for color coding
  const { data: results } = await supabase
    .from('match_results')
    .select('external_match_id, winner_external_id')
    .eq('tournament_id', id)

  const matchResults = Object.fromEntries(
    (results ?? []).map(r => [r.external_match_id, r.winner_external_id])
  )

  const { data: profile } = await supabase
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single()

  return (
    <BracketPredictor
      tournament={tournament}
      draw={draw.bracket_data as any}
      existingPicks={(prediction.picks as Record<string, string>) ?? {}}
      predictionId={prediction.id}
      username={profile?.username ?? ''}
      returnUrl={`/tournaments/${id}`}
      isPractice={prediction.is_practice}
      matchResults={matchResults}
      readOnly
    />
  )
}
