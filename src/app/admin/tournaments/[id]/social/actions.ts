'use server'

import { assertAdmin } from '@/app/admin/auth'
import { getSocialCard, type RecapMatch } from '@/lib/social/data'

export interface RecapMatchOption {
  id: string
  winner: string
  loser: string
  score: string
  pickedCount: number | null
  pickedPct: number | null
  isUpset: boolean
}

export interface RecapMatchList {
  matches: RecapMatchOption[]
  /** The podium eats card height, so the studio needs it to compute capacity. */
  hasPodium: boolean
}

/**
 * The round's matches, for the studio's match picker.
 *
 * This goes through `getSocialCard` rather than querying `match_results`
 * directly, which costs a few redundant reads on an admin-only page and buys
 * something worth more than them: the picker lists exactly the matches the card
 * would render, resolved through the same registry lookup and the same
 * bye-filtering, with the same pick counts. A leaner query here would be a
 * second implementation of "what is in this round", free to drift from the one
 * that produces the PNG — and the whole point of the picker is that ticking a
 * box and looking at the preview describe the same thing.
 */
export async function listRecapMatches(
  tournamentId: string,
  round: string,
): Promise<{ ok: true; data: RecapMatchList } | { ok: false; error: string }> {
  await assertAdmin()

  const result = await getSocialCard(tournamentId, 'recap', { round })
  if (!result.ok) return { ok: false, error: result.error }
  if (result.card.kind !== 'recap') return { ok: false, error: 'Not a recap card' }

  // Flattened to plain strings: CardPlayer's flag is an emoji the picker does not
  // need, and a narrow payload keeps the action's response small on a page that
  // re-fetches it on every round change.
  const toOption = (m: RecapMatch): RecapMatchOption => ({
    id: m.id,
    winner: m.winner.name,
    loser: m.loser.name,
    score: m.score,
    pickedCount: m.pickedCount,
    pickedPct: m.pickedPct,
    isUpset: m.isUpset,
  })

  return {
    ok: true,
    data: {
      matches: result.card.matches.map(toOption),
      hasPodium: result.card.podium.length > 0,
    },
  }
}
