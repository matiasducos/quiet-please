import { requireAdmin } from '../../../auth'
import { getTournamentWithDraw } from '../../../actions'
import { redirect } from 'next/navigation'
import ResultsEntry from './ResultsEntry'

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params

  const { ok, tournament, bracketData, matchResults } = await getTournamentWithDraw(id)
  if (!ok || !tournament || !bracketData) redirect('/admin')

  return (
    <ResultsEntry
      tournamentId={tournament.id}
      tournamentName={tournament.name}
      tournamentLocation={tournament.location ?? null}
      flagEmoji={tournament.flag_emoji ?? null}
      tournamentStatus={tournament.status}
      bracketData={bracketData as { rounds: string[]; matches: Array<{ matchId: string; round: string; player1: { externalId: string; name: string; country: string } | null; player2: { externalId: string; name: string; country: string } | null }> }}
      matchResults={matchResults ?? []}
    />
  )
}
