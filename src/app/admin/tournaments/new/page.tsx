import { requireAdmin } from '../../auth'
import TournamentCreator from './TournamentCreator'

export default async function NewTournamentPage() {
  await requireAdmin()
  return <TournamentCreator />
}
