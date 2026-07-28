import { requireAdmin } from './auth'
import { getManualTournaments, getCronRuns, getAutoPredictStats, getAppSettings } from './actions'
import AdminPanel from './AdminPanel'

export default async function AdminPage() {
  await requireAdmin()
  // getScoringStatus() is deliberately absent: it scans predictions against
  // results, so its cost grows with user count. AdminPanel fetches it after
  // paint instead, keeping page load independent of that query.
  const [{ tournaments }, cronRuns, autoPredictStats, appSettings] = await Promise.all([
    getManualTournaments(),
    getCronRuns(),
    getAutoPredictStats(),
    getAppSettings(),
  ])
  return <AdminPanel tournaments={tournaments} cronRuns={cronRuns} autoPredictStats={autoPredictStats} appSettings={appSettings} />
}
