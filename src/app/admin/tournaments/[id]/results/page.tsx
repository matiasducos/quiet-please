import { requireAdmin } from '../../../auth'
import { getTournamentWithDraw } from '../../../actions'
import { redirect } from 'next/navigation'
import { getPredictionMode } from '@/lib/app-settings'
import ResultsEntry from './ResultsEntry'
import TournamentSwitcher from '@/components/TournamentSwitcher'
import { getAdminSwitcherItems } from '@/lib/tournaments/switcher'

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params

  const [{ ok, tournament, bracketData, lockedMatches, matchResults }, predictionMode, switcherItems] = await Promise.all([
    getTournamentWithDraw(id),
    getPredictionMode(),
    getAdminSwitcherItems(id, 'results'),
  ])
  if (!ok || !tournament) redirect('/admin')
  // No draw yet means there is nothing to enter results against — but the
  // tournament exists, and the switcher can land here on one whose draw is
  // still to be built. The draw builder is the next step, not the admin index.
  if (!bracketData) redirect(`/admin/tournaments/${id}/draw`)

  return (
    <ResultsEntry
      // Keyed so arrowing to another tournament starts from a clean slate —
      // expanded rounds, status messages and edit state all belong to one draw.
      key={tournament.id}
      switcher={<TournamentSwitcher items={switcherItems} currentHref={`/admin/tournaments/${tournament.id}/results`} className="flex-1 max-w-sm" />}
      tournamentId={tournament.id}
      tournamentName={tournament.name}
      tournamentLocation={tournament.location ?? null}
      flagEmoji={tournament.flag_emoji ?? null}
      tournamentStatus={tournament.status}
      bracketData={bracketData as { rounds: string[]; matches: Array<{ matchId: string; round: string; player1: { externalId: string; name: string; country: string } | null; player2: { externalId: string; name: string; country: string } | null }> }}
      matchResults={matchResults ?? []}
      lockedMatches={lockedMatches ?? {}}
      predictionMode={predictionMode}
      emailUpcomingMatchIds={tournament.email_upcoming_match_ids ?? null}
    />
  )
}
