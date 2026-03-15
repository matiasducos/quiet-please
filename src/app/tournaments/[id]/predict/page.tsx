import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import BracketPredictor from './BracketPredictor'

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
  if (tournament.status !== 'accepting_predictions') redirect(`/tournaments/${id}`)

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

  if (prediction?.is_locked) redirect(`/tournaments/${id}`)

  const { data: profile } = await supabase
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single()

  return (
    <BracketPredictor
      tournament={tournament}
      draw={draw.bracket_data as any}
      existingPicks={(prediction?.picks as Record<string, string>) ?? {}}
      predictionId={prediction?.id ?? null}
      username={profile?.username ?? ''}
    />
  )
}
