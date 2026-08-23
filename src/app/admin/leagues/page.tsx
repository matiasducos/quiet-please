import { requireAdmin } from '../auth'
import LeagueBrowser from './LeagueBrowser'

export const metadata = { robots: { index: false, follow: false } }

export default async function AdminLeaguesPage() {
  await requireAdmin()
  // Nothing is fetched here: the list is filter-driven, so it loads
  // client-side after the first paint, as the predictions browser does.
  return <LeagueBrowser />
}
