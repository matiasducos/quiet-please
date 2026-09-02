import { getSocialCard } from '@/lib/social/data'
import { EMAIL_UPCOMING_CAPACITY, favouriteLabel } from '@/lib/social/layout'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PointsAwardedUpcoming } from '@/lib/email'

/**
 * One tie as far as it can be worked out WITHOUT knowing who the mail is going
 * to — everything except the recipient's own pick.
 *
 * The split exists because the two halves have different costs. The line-up and
 * the crowd line take a draw walk and an aggregate query, and are identical for
 * every recipient of that tournament; the recipient's pick is a lookup in a
 * bracket the caller is already holding. Building the whole block per user
 * would pay the expensive half thousands of times for the cheap half.
 */
export interface UpcomingPlanMatch {
  /** The draw's matchId — the key a bracket's `picks` object is stored under. */
  id: string
  a: string
  b: string
  /** External ids, which is what a stored pick actually holds. */
  aId: string
  bId: string
  favourite: string | null
}

export interface UpcomingPlan {
  roundLabel: string
  matches: UpcomingPlanMatch[]
}

/** A recipient's bracket, reduced to the two fields this needs. */
export interface RecipientPicks {
  /** matchId → picked player's external id. */
  picks: Record<string, string> | null
  /**
   * matchIds whose pick was placed after the match was locked. Those score
   * nothing, so naming one as "your pick" would promise points that cannot
   * arrive.
   */
  lockedPicks?: string[] | null
}

/**
 * Fill in the one per-recipient field: which side of each tie this bracket has.
 *
 * Pure, and deliberately strict about what counts as a pick — the same three
 * exclusions migration 077 applies to the crowd line, so the two halves of a
 * row are always talking about the same thing:
 *
 *  1. Only a pick naming one of THESE two players counts. A bracket whose slot
 *     holds someone the draw has since overtaken is a stale pick, not a vote —
 *     see `picks dangle when the draw is overwritten`, which is routine here
 *     because a resolved qualifier silently rewrites a slot.
 *  2. A pick in `lockedPicks` was placed too late to score, so it is not shown.
 *  3. Global brackets only, which is the caller's job — a challenge bracket is
 *     a different `predictions` row for the same match, and showing its pick
 *     would name a player the recipient's real bracket does not have.
 */
export function personaliseUpcoming(plan: UpcomingPlan, bracket: RecipientPicks | null): PointsAwardedUpcoming {
  const picks = bracket?.picks ?? null
  const locked = new Set(bracket?.lockedPicks ?? [])
  return {
    roundLabel: plan.roundLabel,
    matches: plan.matches.map(m => {
      const pick = picks && !locked.has(m.id) ? picks[m.id] : undefined
      return {
        a: m.a,
        b: m.b,
        favourite: m.favourite,
        picked: pick === m.aId ? 'a' : pick === m.bId ? 'b' : null,
      }
    }),
  }
}

/**
 * The "up next" block for each tournament scored in an award-points run.
 *
 * Keyed by tournament and built ONCE PER RUN, not once per recipient. The send
 * loop is per user and batched ten at a time; building this inside it would be
 * a `pendingMatches` walk plus a pick-count RPC per person, for a block every
 * recipient of that tournament sees identically. Invisible at today's volume
 * and exactly the O(n)-where-O(1)-works trap.
 *
 * Routed through `getSocialCard` rather than querying the draw directly, for
 * the same reason `listUpcomingMatches` is: the studio picker, the published
 * card and this email have to agree about what "up next" means, and the answer
 * is derived, not stored. A draw's `bracket_data` is written once at publish,
 * so a quarterfinal's line-up exists nowhere in the database — it is only
 * knowable by walking results forward through the positional feed map.
 *
 * Never throws. The block is an enhancement to an email whose real job is
 * reporting points; a failure here drops the block and leaves the mail intact.
 */
export async function buildPointsEmailUpcoming(
  tournamentIds: string[],
): Promise<Map<string, UpcomingPlan>> {
  const out = new Map<string, UpcomingPlan>()
  if (!tournamentIds.length) return out

  const admin = createAdminClient()
  const { data: rows, error } = await admin
    .from('tournaments')
    .select('id, email_upcoming_match_ids')
    .in('id', tournamentIds)
  if (error) {
    // Destructured and handled: falling through on `data ?? []` would treat a
    // failed lookup as "every tournament is on auto" and quietly publish ties
    // the admin had suppressed.
    console.error('[points-email] upcoming selection lookup failed:', error.message)
    return out
  }

  const selections = new Map<string, string[] | null>(
    (rows ?? []).map((r: { id: string; email_upcoming_match_ids: string[] | null }) => [
      r.id,
      r.email_upcoming_match_ids ?? null,
    ]),
  )

  await Promise.all(
    tournamentIds.map(async tournamentId => {
      // Three states, per migration 104: null (or a row we could not read) is
      // auto, an empty array is the admin suppressing the block, and a
      // non-empty one is an explicit choice.
      const selected = selections.get(tournamentId) ?? null
      if (selected && selected.length === 0) return

      try {
        const result = await getSocialCard(
          tournamentId,
          'upcoming',
          selected ? { matchIds: selected } : {},
        )
        // Not an error worth logging: "every known tie has a result" is the
        // ordinary state of a tournament that just finished, and the completion
        // email is what covers that case.
        if (!result.ok || result.card.kind !== 'upcoming') return
        const card = result.card

        // Same contract as UpcomingArt: an explicit selection wins, otherwise
        // the round is taken from the top, and the cap applies either way.
        //
        // The falsy-length branch is also the stale-selection fallback, and it
        // is why this reads `card.selectedIds` rather than the `selected` we
        // passed in. getSocialCard drops ids that are not pending in the round
        // it settled on, so a selection made before a result was reversed — or
        // before the round it named finished — survives as an empty list. A
        // stale choice should degrade to the next round's first few ties, not
        // to silence.
        const chosen = card.selectedIds?.length
          ? card.matches.filter(m => card.selectedIds!.includes(m.id))
          : card.matches
        const matches = chosen.slice(0, EMAIL_UPCOMING_CAPACITY)
        if (!matches.length) return

        out.set(tournamentId, {
          roundLabel: card.roundLabel,
          matches: matches.map(m => ({
            id: m.id,
            a: m.a.name,
            b: m.b.name,
            aId: m.aId,
            bId: m.bId,
            favourite: m.favourite
              ? favouriteLabel(m.favourite.player.name, m.favourite.count, m.favourite.pct)
              : null,
          })),
        })
      } catch (err) {
        console.error(`[points-email] upcoming block failed for ${tournamentId}:`, err)
      }
    }),
  )

  return out
}
