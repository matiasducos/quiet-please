import { requireAdmin } from './auth'
import { getManualTournaments } from './actions'
import AdminPanel from './AdminPanel'

export default async function AdminPage() {
  await requireAdmin()
  const { tournaments } = await getManualTournaments()
  return <AdminPanel tournaments={tournaments} />
}
