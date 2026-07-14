/**
 * Qualifier pick remapping.
 *
 * A prediction is stored as `picks[matchId] = playerExternalId`, and everything
 * downstream (dead-pick display, scoring) matches by that externalId. This is
 * fine for named players whose id never changes — but a *qualifier* slot starts
 * life as a placeholder (`{ externalId: 'qualifier-1' | 'Qualifier', name:
 * 'Qualifier' }`) and later resolves to a real player with a brand-new id. The
 * `matchId` and slot position stay the same; only the player id changes.
 *
 * When `sync-draws` blindly overwrites the stored draw with the resolved one,
 * every pick that referenced the old placeholder id becomes a dangling
 * reference: the UI flags it "Your pick eliminated" and the cron awards no
 * points even if the player who filled the slot wins.
 *
 * The stable identity of a first-round slot is `(matchId, slot)`, not the
 * player id. So the correct fix is: when a slot transitions from a qualifier
 * placeholder to a real player, rewrite any stored pick that pointed at the old
 * placeholder id (in that match) to the new player id. This module computes
 * those remaps by diffing the previous draw against the incoming one.
 */

/** Minimal structural shape — avoids coupling to the full DrawMatch/Player types. */
interface SlotPlayerLike {
  externalId?: string | null
  name?: string | null
}
interface DrawMatchLike {
  matchId: string
  player1: SlotPlayerLike | null
  player2: SlotPlayerLike | null
}
export interface DrawLike {
  matches?: DrawMatchLike[] | null
}

export interface QualifierRemap {
  matchId: string
  oldId: string
  newId: string
}

/**
 * Is this slot an unresolved qualifier placeholder?
 *
 * Detection is name-first so it works regardless of how the id was minted:
 * the manual draw builder uses `qualifier-N`, while the API provider falls back
 * to the literal team name ("Qualifier") when no player key is available.
 */
export function isQualifierPlaceholder(p: SlotPlayerLike | null): boolean {
  if (!p) return false
  if ((p.name ?? '').trim().toLowerCase() === 'qualifier') return true
  const id = (p.externalId ?? '').trim().toLowerCase()
  return id === 'qualifier' || id.startsWith('qualifier-')
}

/**
 * Diff the previously-stored draw against the incoming one and return the set of
 * qualifier→real-player transitions. Only slots that were a qualifier placeholder
 * and now hold a real player (with a different id) are remapped — a plain player
 * swap or a still-unresolved slot is left untouched.
 */
export function buildQualifierRemaps(oldDraw: DrawLike | null | undefined, newDraw: DrawLike | null | undefined): QualifierRemap[] {
  const oldMatches = oldDraw?.matches ?? []
  const newMatches = newDraw?.matches ?? []
  if (oldMatches.length === 0 || newMatches.length === 0) return []

  const oldById = new Map(oldMatches.map(m => [m.matchId, m]))
  const remaps: QualifierRemap[] = []

  for (const nm of newMatches) {
    const om = oldById.get(nm.matchId)
    if (!om) continue

    const perMatch: QualifierRemap[] = []
    for (const slot of ['player1', 'player2'] as const) {
      const oldP = om[slot]
      const newP = nm[slot]
      const newId = newP?.externalId ?? null
      const oldId = oldP?.externalId ?? null
      // Old slot was a qualifier placeholder; new slot is a real, resolved player.
      if (isQualifierPlaceholder(oldP) && newId && !isQualifierPlaceholder(newP) && newId !== oldId && oldId) {
        perMatch.push({ matchId: nm.matchId, oldId, newId })
      }
    }

    // A pick stores only the placeholder id, keyed by matchId. If both slots
    // shared the same placeholder id (the API name-fallback case, two qualifiers
    // in one match), the stored pick is ambiguous — we can't tell which one the
    // user meant, so we skip both rather than guess and mis-score.
    if (perMatch.length === 2 && perMatch[0].oldId === perMatch[1].oldId) continue
    remaps.push(...perMatch)
  }

  return remaps
}
