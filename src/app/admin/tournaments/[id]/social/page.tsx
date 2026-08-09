import { notFound } from 'next/navigation'
import { requireAdmin } from '@/app/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUND_ORDER, ROUND_LABEL } from '@/lib/tennis/my-tournament'
import SocialStudio from './SocialStudio'

/**
 * Which cards a tournament can produce depends on how far along it is: there is
 * no draw card before a draw exists, no recap before results are entered, and no
 * champion card before a final. Resolving that here means the studio opens on a
 * card that will actually render, rather than showing the admin three tabs where
 * two of them 422.
 */
export default async function SocialCardsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const admin = createAdminClient()

  const [{ data: tournament }, { data: draw }, { data: results }, { data: recap }] = await Promise.all([
    admin.from('tournaments').select('id, name, flag_emoji, status').eq('id', id).single(),
    admin.from('draws').select('tournament_id').eq('tournament_id', id).maybeSingle(),
    admin.from('match_results').select('round').eq('tournament_id', id).limit(500),
    // The stats card reads the stored recap and nothing else, so its tab is
    // gated on the row existing rather than on the completed status — a
    // tournament can be completed for a cron cycle before its recap is built.
    admin.from('tournament_recaps').select('tournament_id').eq('tournament_id', id).maybeSingle(),
  ])

  if (!tournament) notFound()

  const roundsPresent = new Set((results ?? []).map(r => r.round))
  const rounds = ROUND_ORDER.filter(r => roundsPresent.has(r)).map(r => ({
    round: r as string,
    label: ROUND_LABEL[r] ?? r,
  }))

  return (
    <SocialStudio
      tournamentId={tournament.id}
      tournamentName={tournament.name}
      flagEmoji={tournament.flag_emoji ?? ''}
      hasDraw={!!draw}
      rounds={rounds}
      hasFinal={roundsPresent.has('F')}
      hasRecap={!!recap}
    />
  )
}
