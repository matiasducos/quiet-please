import { requireAdmin } from './auth'
import { getManualTournaments, getScoringStatus } from './actions'
import AdminPanel from './AdminPanel'

export default async function AdminPage() {
  await requireAdmin()
  const [{ tournaments }, scoringStatus] = await Promise.all([
    getManualTournaments(),
    getScoringStatus(),
  ])
  return <AdminPanel tournaments={tournaments} scoringStatus={scoringStatus} />
}
