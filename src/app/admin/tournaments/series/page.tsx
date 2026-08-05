import { requireAdmin } from '../../auth'
import { listSeriesForAdmin } from '../../actions'
import SeriesList from './SeriesList'

/**
 * Series naming, the SEO surface.
 *
 * Separate from /admin/tournaments/[id]/edit because they own different things:
 * that page edits one EDITION (its sponsor name, dates, draw size), this one
 * edits the SERIES — the name every edition inherits into its <h1>, <title> and
 * structured data, and the URL they all hang off.
 */
export default async function SeriesAdminPage() {
  await requireAdmin()
  const series = await listSeriesForAdmin()

  return <SeriesList series={series} />
}
