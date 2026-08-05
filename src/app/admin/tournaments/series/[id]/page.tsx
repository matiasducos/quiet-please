import { notFound } from 'next/navigation'
import { requireAdmin } from '../../../auth'
import { getSeriesForAdmin } from '../../../actions'
import SeriesEditor from './SeriesEditor'

export default async function EditSeriesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params

  const series = await getSeriesForAdmin(id)
  if (!series) notFound()

  return <SeriesEditor series={series} />
}
