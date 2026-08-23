import { requireAdmin } from '../auth'
import { listPredictionTournaments } from '../predictions/actions'
import ChallengeBrowser from './ChallengeBrowser'

export const metadata = { robots: { index: false, follow: false } }

export default async function AdminChallengesPage() {
  await requireAdmin()
  // Same picker as the predictions browser — every tournament, newest first.
  // Reused rather than duplicated: the list and its 200-row cap are identical.
  const { tournaments } = await listPredictionTournaments()
  return <ChallengeBrowser tournaments={tournaments} />
}
