/**
 * Qualifier pick remapping.
 *
 * A prediction is stored as `picks[matchId] = playerExternalId`, and everything
 * downstream (void-pick display, scoring) matches by that externalId. This is
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
 * those remaps by diffing the previous draw against the incoming one, and
 * applies them to every pick-storage model we have.
 *
 * Every path that overwrites a stored draw must run this — `sync-draws` and
 * both admin publish paths. A draw save that skips it silently zeroes the
 * affected picks: they can never match a result again, so the cron awards
 * nothing and the tournament page labels the pick "Qualifier" forever.
 */

import type { createAdminClient } from '@/lib/supabase/admin'

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
 * The placeholder id for an unresolved slot, derived from the slot itself.
 *
 * It has to be a pure function of `(matchIndex, slot)` and nothing else. The
 * first version numbered qualifiers with a running counter over the slots that
 * happened to be unresolved — so resolving one qualifier renumbered every later
 * one, and picks that stored `qualifier-6` silently came to mean a different
 * match. Deriving the id from the slot means an unresolved slot keeps its id
 * across saves no matter what happens around it, and the only id that ever
 * changes is the one that actually resolved.
 *
 * The `-p1`/`-p2` suffix also keeps these ids disjoint from the old
 * `qualifier-<n>` ones, so a remap can never chain into another remap's id.
 */
export function qualifierSlotId(matchIndex: number, slot: 'player1' | 'player2'): string {
  return `qualifier-${String(matchIndex + 1).padStart(3, '0')}-${slot === 'player1' ? 'p1' : 'p2'}`
}

/**
 * Diff the previously-stored draw against the incoming one and return the set of
 * id transitions for slots that were a qualifier placeholder. A plain player
 * swap is left untouched, but a placeholder→placeholder change is remapped like
 * any other: the pick means "whoever fills this slot", so it has to follow the
 * slot even when the new occupant is still unknown (that is how picks survive an
 * id-scheme change, and how they survived the old renumbering counter).
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
      // Old slot was a qualifier placeholder and the slot's id has changed —
      // either because it resolved to a real player, or because the placeholder
      // itself was re-minted. A slot that emptied out (BYE) has no id to point
      // the pick at, so it is left alone.
      if (isQualifierPlaceholder(oldP) && oldId && newId && newId !== oldId) {
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

/**
 * Rewrite stale qualifier picks to the resolved player id for one tournament.
 *
 * Covers both pick-storage models:
 *   • `predictions.picks`  — global predictions AND friends challenges
 *   • `challenges.creator_picks` / `opponent_picks` — anonymous challenges
 *
 * Scalability: `.contains()` pushes the filter to Postgres so we only fetch the
 * rows that actually reference a resolved qualifier — not every prediction in
 * the tournament. The query count is bounded by the number of slots that
 * changed, and this only runs on the one save where they change (afterwards the
 * stored draw already holds the new ids, so the diff is empty).
 */
export async function applyQualifierRemaps(
  supabase: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  remaps: QualifierRemap[],
  logLabel: string,
): Promise<{ predictions: number; challenges: number }> {
  // A user who advanced their Qualifier deeper into the bracket stored the
  // SAME placeholder id as the pick VALUE under later-round matchIds. Those
  // must be remapped too, or the downstream picks stay dangling. Safe only
  // when the placeholder id maps to a single new id: manual draws mint one id
  // per slot, but the API name-fallback can mint the same literal 'Qualifier'
  // id for several slots — those get key-level remapping only (the first-round
  // matchId is still unambiguous).
  const newIdsByOldId = new Map<string, Set<string>>()
  for (const r of remaps) {
    if (!newIdsByOldId.has(r.oldId)) newIdsByOldId.set(r.oldId, new Set())
    newIdsByOldId.get(r.oldId)!.add(r.newId)
  }
  // …and only when the id it writes is not itself waiting to be remapped.
  // Otherwise a later remap in the same batch would rewrite the value this one
  // just wrote, moving the pick to a slot the user never touched. Slot-derived
  // ids make that impossible, but nothing here should depend on the id scheme.
  const pendingOldIds = new Set(remaps.map(r => r.oldId))
  const canSweepValues = (r: QualifierRemap) =>
    newIdsByOldId.get(r.oldId)!.size === 1 && !pendingOldIds.has(r.newId)

  const remapPicks = (picks: Record<string, string>, r: QualifierRemap): Record<string, string> => {
    const out = { ...picks }
    if (out[r.matchId] === r.oldId) out[r.matchId] = r.newId
    if (canSweepValues(r)) {
      for (const [mid, v] of Object.entries(out)) {
        if (v === r.oldId) out[mid] = r.newId
      }
    }
    return out
  }

  // ── predictions (global + friends) ──────────────────────────────────────
  // id → the picks object being mutated (so a prediction touching two resolved
  // qualifiers is fetched once and updated once). Any prediction with a
  // downstream placeholder pick necessarily has the first-round pick too
  // (the bracket UI requires the feeder pick), so the key-level .contains()
  // filter finds every affected row.
  const predPicks = new Map<string, Record<string, string>>()
  for (const r of remaps) {
    const { data, error } = await supabase
      .from('predictions')
      .select('id, picks')
      .eq('tournament_id', tournamentId)
      .contains('picks', { [r.matchId]: r.oldId })
    if (error) throw new Error(`predictions read: ${error.message}`)
    for (const row of data ?? []) {
      const picks = predPicks.get(row.id) ?? { ...(row.picks as Record<string, string>) }
      predPicks.set(row.id, remapPicks(picks, r))
    }
  }
  const predResults = await Promise.allSettled(
    [...predPicks].map(([id, picks]) => supabase.from('predictions').update({ picks }).eq('id', id)),
  )

  // ── anonymous challenges ────────────────────────────────────────────────
  // id → column patch (creator/opponent picks are independent jsonb columns).
  const challPatches = new Map<string, { creator_picks?: Record<string, string>; opponent_picks?: Record<string, string> }>()
  const collectChallenge = (col: 'creator_picks' | 'opponent_picks', id: string, current: Record<string, string> | null, r: QualifierRemap) => {
    const patch = challPatches.get(id) ?? {}
    const picks = patch[col] ?? { ...(current ?? {}) }
    patch[col] = remapPicks(picks, r)
    challPatches.set(id, patch)
  }
  for (const r of remaps) {
    const [creatorRes, opponentRes] = await Promise.all([
      supabase.from('challenges').select('id, creator_picks').eq('tournament_id', tournamentId).contains('creator_picks', { [r.matchId]: r.oldId }),
      supabase.from('challenges').select('id, opponent_picks').eq('tournament_id', tournamentId).contains('opponent_picks', { [r.matchId]: r.oldId }),
    ])
    if (creatorRes.error) throw new Error(`challenges read (creator_picks): ${creatorRes.error.message}`)
    if (opponentRes.error) throw new Error(`challenges read (opponent_picks): ${opponentRes.error.message}`)
    for (const row of creatorRes.data ?? []) collectChallenge('creator_picks', row.id, row.creator_picks as Record<string, string> | null, r)
    for (const row of opponentRes.data ?? []) collectChallenge('opponent_picks', row.id, row.opponent_picks as Record<string, string> | null, r)
  }
  const challResults = await Promise.allSettled(
    [...challPatches].map(([id, patch]) => supabase.from('challenges').update(patch).eq('id', id)),
  )

  const failed = [...predResults, ...challResults].filter(r => r.status === 'rejected').length
  if (failed > 0) console.error(`[${logLabel}] ${failed} qualifier-remap update(s) failed for tournament ${tournamentId}`)

  return { predictions: predPicks.size, challenges: challPatches.size }
}

/**
 * Read the stored draw, diff it against the one about to replace it, and rewrite
 * the affected picks. Call it AFTER the new draw is committed: the remaps are
 * computed from `oldDraw` passed in by the caller, which must have read it
 * before the overwrite.
 *
 * Returns a one-line summary for the caller's log, or null when nothing moved.
 */
export async function remapResolvedQualifiers(
  supabase: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  oldDraw: DrawLike | null | undefined,
  newDraw: DrawLike,
  logLabel: string,
): Promise<string | null> {
  const remaps = buildQualifierRemaps(oldDraw, newDraw)
  if (remaps.length === 0) return null
  const { predictions, challenges } = await applyQualifierRemaps(supabase, tournamentId, remaps, logLabel)
  return `${remaps.length} qualifier slot(s) changed id, remapped ${predictions} prediction(s) + ${challenges} anonymous challenge(s)`
}
