import { requireAdmin } from './auth'
import { getManualTournaments, getScoringStatus, getCronRuns } from './actions'
import AdminPanel from './AdminPanel'

export default async function AdminPage() {
  await requireAdmin()
  const [{ tournaments }, scoringStatus, cronRuns] = await Promise.all([
    getManualTournaments(),
    getScoringStatus(),
    getCronRuns(),
  ])
  return <AdminPanel tournaments={tournaments} scoringStatus={scoringStatus} cronRuns={cronRuns} />
}
