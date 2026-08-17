import { notFound } from 'next/navigation'
import { requireAdmin } from '@/app/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUND_ORDER, ROUND_LABEL } from '@/lib/tennis/my-tournament'
import { pendingMatches, type RawDrawMatch } from '@/lib/social/data'
import { resolveLegacyTournamentId } from '@/lib/tournaments/series'
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

  const [{ data: tournament }, { data: draw }, { data: results }, { data: recap }, legacy] = await Promise.all([
    admin.from('tournaments').select('id, name, flag_emoji, status').eq('id', id).single(),
    // bracket_data, not just the id: the "Up next" tab is gated on there being a
    // match left to play, and that is only derivable from the draw plus the
    // results walked forward through it.
    admin.from('draws').select('bracket_data').eq('tournament_id', id).maybeSingle(),
    admin
      .from('match_results')
      .select('external_match_id, round, winner_external_id')
      .eq('tournament_id', id)
      .limit(500),
    // The stats card reads the stored recap and nothing else, so its tab is
    // gated on the row existing rather than on the completed status — a
    // tournament can be completed for a cron cycle before its recap is built.
    admin.from('tournament_recaps').select('tournament_id').eq('tournament_id', id).maybeSingle(),
    // Series slug + year for the campaign link the studio hands the admin to
    // paste into the post. Null for a tournament with no reviewed series — the
    // link falls back to the UUID below, which /play resolves just as well.
    resolveLegacyTournamentId(id).catch(() => null),
  ])

  if (!tournament) notFound()

  const roundsPresent = new Set((results ?? []).map(r => r.round))
  const rounds = ROUND_ORDER.filter(r => roundsPresent.has(r)).map(r => ({
    round: r as string,
    label: ROUND_LABEL[r] ?? r,
  }))

  // The same function the card and the picker use, so a tab that opens is a tab
  // that renders. The round list itself is not passed down — the studio gets it
  // from `listUpcomingMatches` alongside the matches, since both come from this
  // one derivation.
  const drawMatches = ((draw?.bracket_data as { matches?: RawDrawMatch[] } | null)?.matches ?? [])
  const hasUpcoming = pendingMatches(drawMatches, results ?? []).length > 0

  return (
    <SocialStudio
      tournamentId={tournament.id}
      tournamentName={tournament.name}
      flagEmoji={tournament.flag_emoji ?? ''}
      hasDraw={!!draw}
      hasUpcoming={hasUpcoming}
      rounds={rounds}
      hasFinal={roundsPresent.has('F')}
      hasRecap={!!recap}
      // The evergreen series slug wherever there is one, so the same link keeps
      // working next season and the campaign name stays comparable year on year.
      playSlug={legacy?.slug ?? tournament.id}
      playCampaign={legacy ? `${legacy.slug}-${legacy.year}` : tournament.id}
    />
  )
}
