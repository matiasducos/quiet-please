import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTournamentParam } from '@/lib/tournaments/series'

/**
 * Shared logic for the signed-out bracket entry point (/play/[slug]).
 *
 * Two jobs live here rather than in the page: working out which tournament a
 * campaign link should actually open, and deciding which of a visitor's picks
 * are worth nothing because the match was already over when they made them.
 */

/** Statuses a bracket can be filled in for. Mirrors the anonymous challenge
 *  rule deliberately: both bypass the global prediction-mode toggle, because a
 *  campaign link that dead-ends on a config flag is worse than useless — it
 *  spends real ad attention on an error page. */
const PLAYABLE = ['accepting_predictions', 'in_progress'] as const

export type PlayableTournament = {
  id: string
  name: string
  location: string | null
  flag_emoji: string | null
  tour: string
  category: string
  status: string
  starts_at: string
  ends_at: string
  series_slug: string | null
}

/** Why the link's own tournament could not be served. The two read very
 *  differently to a visitor — "that one's over" versus "that one hasn't
 *  started" — and getting it backwards on a campaign landing is the kind of
 *  wrong that makes the product look broken. */
export type SubstitutionReason = 'finished' | 'not-open-yet'

export type PlayResolution =
  | {
      kind: 'playable'
      tournament: PlayableTournament
      draw: any
      adminLockedMatches: Record<string, string>
      substituted: null | { requestedName: string; reason: SubstitutionReason }
    }
  | { kind: 'nothing-open'; requested: PlayableTournament | null }

const TOURNAMENT_FIELDS =
  'id, name, location, flag_emoji, tour, category, status, starts_at, ends_at'

async function loadDraw(tournamentId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('draws')
    .select('bracket_data, locked_matches')
    .eq('tournament_id', tournamentId)
    .maybeSingle()
  if (error) {
    console.error('[anonymous-predictions] draw query failed:', error.message)
    return null
  }
  return data
}

/**
 * Turn a campaign slug into something the visitor can actually play.
 *
 * The substitution is the point of this function. Social posts go out daily
 * and the link in them outlives the tournament it named: someone opening
 * Monday's story on Thursday, or a bio link nobody updated, lands on a draw
 * that is finished or was never published. Sending them to an apology is how
 * you waste the click. Instead the next open draw is served with an honest
 * note about the swap.
 */
/*
 * Wrapped in React's `cache` because generateMetadata and the page body both
 * need the answer, and without it every request would run the whole resolution
 * — series lookup, tournament row, draw, and possibly the fallback scan —
 * twice. Next dedupes `fetch`, not Supabase queries.
 */
export const resolvePlayableTournament = cache(async function resolvePlayableTournament(
  routeParam: string,
): Promise<PlayResolution> {
  const admin = createAdminClient()

  const resolved = await resolveTournamentParam(routeParam)

  let requested: PlayableTournament | null = null
  if (resolved) {
    const { data, error } = await admin
      .from('tournaments')
      .select(TOURNAMENT_FIELDS)
      .eq('id', resolved.tournamentId)
      .single()
    if (error) console.error('[anonymous-predictions] tournament query failed:', error.message)
    if (data) requested = { ...data, series_slug: resolved.slug } as PlayableTournament
  }

  // Happy path: the tournament the link named is open and has a draw.
  if (requested && (PLAYABLE as readonly string[]).includes(requested.status)) {
    const draw = await loadDraw(requested.id)
    if (draw?.bracket_data?.matches?.length) {
      return {
        kind: 'playable',
        tournament: requested,
        draw: draw.bracket_data,
        adminLockedMatches: (draw.locked_matches as Record<string, string>) ?? {},
        substituted: null,
      }
    }
  }

  // Otherwise find the soonest tournament that is open. Ordered by start date
  // so a visitor gets the event closest to now rather than an arbitrary row.
  const { data: candidates, error: candErr } = await admin
    .from('tournaments')
    .select(TOURNAMENT_FIELDS)
    .in('status', PLAYABLE as unknown as string[])
    .order('starts_at', { ascending: true })
    .limit(10)

  if (candErr) console.error('[anonymous-predictions] candidate query failed:', candErr.message)

  for (const candidate of candidates ?? []) {
    if (requested && candidate.id === requested.id) continue
    const draw = await loadDraw(candidate.id)
    if (!draw?.bracket_data?.matches?.length) continue
    return {
      kind: 'playable',
      tournament: { ...candidate, series_slug: null } as PlayableTournament,
      draw: draw.bracket_data,
      adminLockedMatches: (draw.locked_matches as Record<string, string>) ?? {},
      substituted: requested
        ? {
            requestedName: requested.location ?? requested.name,
            // `completed` is the only status that means "over". Everything
            // else that lands here — upcoming, draw_published, or open but
            // with no draw row yet — is a tournament whose bracket simply
            // isn't fillable yet, which is the common case for a link posted
            // ahead of a draw going up.
            reason: requested.status === 'completed' ? 'finished' : 'not-open-yet',
          }
        : null,
    }
  }

  return { kind: 'nothing-open', requested }
})

/**
 * Which of these picks are worth zero.
 *
 * A pick counts as locked if the match already has a result, or if an admin
 * locked it in `manual_lock` mode. The union matters: those two sets normally
 * agree (matches are locked as they start, results land afterwards) but they
 * are maintained by different mechanisms, and the safe direction is to take
 * whichever is ahead.
 *
 * Unlike the anonymous CHALLENGE path this does not consult the prediction
 * mode. A challenge is scored between two strangers and touches nobody's
 * ranking; a bracket claimed from here becomes a real prediction. Leaving the
 * results-based half of this behind a config flag would mean that flipping the
 * flag silently opens a route to banking points for matches already played.
 */
export function computeLockedPicks(
  picks: Record<string, string>,
  decidedMatchIds: Iterable<string>,
  adminLockedMatchIds: Iterable<string>,
): string[] {
  const locked = new Set<string>()
  for (const matchId of decidedMatchIds) if (matchId in picks) locked.add(matchId)
  for (const matchId of adminLockedMatchIds) if (matchId in picks) locked.add(matchId)
  return [...locked]
}

/** True when the tournament still accepts new brackets. */
export function isPlayableStatus(status: string): boolean {
  return (PLAYABLE as readonly string[]).includes(status)
}
