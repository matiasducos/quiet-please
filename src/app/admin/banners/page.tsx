import { requireAdmin } from '../auth'
import { getBannerReport } from './status'
import BannerStatus from './BannerStatus'

export const metadata = { robots: { index: false, follow: false } }

/**
 * Informational only — see `status.ts` for what is evaluated and why the
 * per-user bar is reported against a baseline rather than counted.
 *
 * Dynamic rather than cached: the whole point is the state of the site at the
 * moment it is opened, and the reads underneath are already cached individually
 * with the same entries Nav uses.
 */
export const dynamic = 'force-dynamic'

export default async function AdminBannersPage() {
  await requireAdmin()
  const report = await getBannerReport()
  return <BannerStatus report={report} />
}
