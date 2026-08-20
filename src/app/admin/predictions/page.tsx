import { requireAdmin } from '../auth'
import { listPredictionTournaments } from './actions'
import PredictionBrowser from './PredictionBrowser'

export const metadata = { robots: { index: false, follow: false } }

export default async function AdminPredictionsPage() {
  await requireAdmin()
  // Only the picker is fetched on the server — the bracket list itself is
  // filter-driven, so it loads client-side after the first paint.
  const { tournaments } = await listPredictionTournaments()
  return <PredictionBrowser tournaments={tournaments} />
}
