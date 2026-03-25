import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import BracketPredictor from '../predict/BracketPredictor'
import type { Metadata } from 'next'

const getTournamentResults = unstable_cache(
  async (id: string) => {
    const supabase = createAdminClient()
    const [{ data: tournament }, { data: draw }, { data: results }] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', id).single(),
      supabase.from('draws').select('bracket_data').eq('tournament_id', id).single(),
      supabase.from('match_results').select('external_match_id, winner_external_id').eq('tournament_id', id),
    ])
    return { tournament, draw, results: results ?? [] }
  },
  ['tournament-results'],
  { revalidate: 300, tags: ['tournament-detail'] }
)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { tournament } = await getTournamentResults(id)
  return { title: tournament ? `Draw Results — ${tournament.name}` : 'Draw Results' }
}

export default async function TournamentResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { tournament, draw, results } = await getTournamentResults(id)

  if (!tournament) notFound()
  if (!draw?.bracket_data) redirect(`/tournaments/${id}`)

  // Build matchResults map: matchId → winnerExternalId (same format BracketPredictor expects)
  const matchResults: Record<string, string> = Object.fromEntries(
    results.map((r: any) => [r.external_match_id, r.winner_external_id])
  )

  return (
    <BracketPredictor
      tournament={tournament}
      draw={draw.bracket_data as any}
      existingPicks={{}}
      predictionId={null}
      username=""
      returnUrl={`/tournaments/${id}`}
      matchResults={matchResults}
      readOnly
      hideSaveButtons
      drawResultsMode
    />
  )
}
