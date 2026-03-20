import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../auth'
import { redirect } from 'next/navigation'
import DrawBuilder from './DrawBuilder'

export default async function DrawPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params

  const admin = createAdminClient()
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, name, draw_size, tour')
    .eq('id', id)
    .eq('is_manual', true)
    .single()

  if (!tournament) redirect('/admin')

  return (
    <DrawBuilder
      tournamentId={tournament.id}
      tournamentName={tournament.name}
      drawSize={tournament.draw_size ?? 32}
      tour={tournament.tour as 'ATP' | 'WTA'}
    />
  )
}
