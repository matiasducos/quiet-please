import { requireAdmin } from '../../../auth'
import { getTournament } from '../../../actions'
import { redirect } from 'next/navigation'
import TournamentEditor from './TournamentEditor'

export default async function EditTournamentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params

  const { ok, tournament } = await getTournament(id)
  if (!ok || !tournament) redirect('/admin')

  return <TournamentEditor tournament={tournament} />
}
