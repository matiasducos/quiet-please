import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import BracketPredictor from './BracketPredictor'
import { TEST_EXTERNAL_ID } from '@/app/test-tournaments/constants'

export default async function PredictPage({ params }: { params: Promise<{ id: string }> }) {
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

  const isPractice = tournament.status === 'completed'
  const isTest = tournament.external_id === TEST_EXTERNAL_ID
  const returnUrl = isTest ? '/test-tournaments' : `/tournaments/${id}`

  // Only allow predict page for accepting_predictions (real) and completed (practice)
  if (tournament.status !== 'accepting_predictions' && !isPractice) {
    redirect(returnUrl)
  }

  const { data: draw } = await supabase
    .from('draws')
    .select('bracket_data')
    .eq('tournament_id', id)
    .single()

  if (!draw?.bracket_data) redirect(`/tournaments/${id}`)

  const { data: prediction } = await supabase
    .from('predictions')
    .select('id, picks, is_locked')
    .eq('tournament_id', id)
    .eq('user_id', user.id)
    .single()

  const { data: profile } = await supabase
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single()

  // Fetch match results for: practice mode, locked picks (readOnly), and in_progress tournaments
  const needsResults = isPractice || prediction?.is_locked ||
    tournament.status === 'in_progress' || tournament.status === 'completed'

  let matchResults: Record<string, string> = {}
  if (needsResults) {
    const { data: results } = await supabase
      .from('match_results')
      .select('external_match_id, winner_external_id')
      .eq('tournament_id', id)
    matchResults = Object.fromEntries(
      (results ?? []).map(r => [r.external_match_id, r.winner_external_id])
    )
  }

  // Locked picks → show readOnly bracket with results overlay
  if (prediction?.is_locked) {
    return (
      <BracketPredictor
        tournament={tournament}
        draw={draw.bracket_data as any}
        existingPicks={(prediction.picks as Record<string, string>) ?? {}}
        predictionId={prediction.id}
        username={profile?.username ?? ''}
        returnUrl={returnUrl}
        matchResults={matchResults}
        readOnly
        shareUrl={profile?.username ? `/tournaments/${id}/picks/${profile.username}` : undefined}
      />
    )
  }

  return (
    <BracketPredictor
      tournament={tournament}
      draw={draw.bracket_data as any}
      existingPicks={(prediction?.picks as Record<string, string>) ?? {}}
      predictionId={prediction?.id ?? null}
      username={profile?.username ?? ''}
      returnUrl={returnUrl}
      isPractice={isPractice}
      matchResults={matchResults}
    />
  )
}
