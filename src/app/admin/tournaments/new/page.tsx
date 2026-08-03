import { requireAdmin } from '../../auth'
import { listTournamentSeries } from '../../actions'
import TournamentCreator from './TournamentCreator'

export default async function NewTournamentPage() {
  await requireAdmin()
  // Fetched here rather than in a client effect: the list is needed on first
  // paint, and this keeps the form free of a set-state-in-effect fetch.
  const series = await listTournamentSeries()
  return <TournamentCreator series={series} />
}
