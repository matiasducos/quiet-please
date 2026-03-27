import { requireAdmin } from './auth'
import { getManualTournaments, getScoringStatus, getCronRuns, getAutoPredictStats } from './actions'
import AdminPanel from './AdminPanel'

export default async function AdminPage() {
  await requireAdmin()
  const [{ tournaments }, scoringStatus, cronRuns, autoPredictStats] = await Promise.all([
    getManualTournaments(),
    getScoringStatus(),
    getCronRuns(),
    getAutoPredictStats(),
  ])
  return <AdminPanel tournaments={tournaments} scoringStatus={scoringStatus} cronRuns={cronRuns} autoPredictStats={autoPredictStats} />
}
