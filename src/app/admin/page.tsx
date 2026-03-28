import { requireAdmin } from './auth'
import { getManualTournaments, getScoringStatus, getCronRuns, getAutoPredictStats, getAppSettings } from './actions'
import AdminPanel from './AdminPanel'

export default async function AdminPage() {
  await requireAdmin()
  const [{ tournaments }, scoringStatus, cronRuns, autoPredictStats, appSettings] = await Promise.all([
    getManualTournaments(),
    getScoringStatus(),
    getCronRuns(),
    getAutoPredictStats(),
    getAppSettings(),
  ])
  return <AdminPanel tournaments={tournaments} scoringStatus={scoringStatus} cronRuns={cronRuns} autoPredictStats={autoPredictStats} appSettings={appSettings} />
}
