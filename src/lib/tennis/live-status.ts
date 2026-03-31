/**
 * Live match status → auto-lock logic.
 *
 * Maps DSG live matches to our bracket_data matches and determines
 * which matches should be auto-locked because they have started.
 *
 * Pure function module — no side effects. The cron job handles
 * writing locks to the database.
 */

import type { DrawMatch, Round } from './types'

// ── Types ────────────────────────────────────────────────────────────────────

/** Simplified DSG match for mapping (pre-normalized by the cron) */
export interface DSGLiveMatch {
  match_id: string
  status: string                // "Playing", "Played", "Suspended", etc.
  home_contestant_id: string    // DSG player ID
  away_contestant_id: string    // DSG player ID
  round: string                 // DSG round name (e.g., "Quarter-finals")
}

/** Result: a bracket match that should be locked */
export interface MatchLockResult {
  matchId: string               // bracket_data matchId (api-tennis event_key)
  dsgMatchId: string            // DSG match_id for audit trail
  reason: 'live' | 'played'    // why we're locking it
}

// ── DSG status classification ────────────────────────────────────────────────

/** DSG statuses that indicate a match has started or finished */
const DSG_LIVE_STATUSES = new Set([
  'Playing',
  'Played',
  'Suspended',
  'Interrupted',
  // Add more as discovered from actual DSG responses
])

// ── DSG round normalization ──────────────────────────────────────────────────

const DSG_ROUND_MAP: Record<string, Round> = {
  'Final': 'F',
  'The Final': 'F',
  'Semi-finals': 'SF',
  'Semi-final': 'SF',
  'Quarter-finals': 'QF',
  'Quarter-final': 'QF',
  'Round of 16': 'R16',
  '4th Round': 'R16',
  'Round of 32': 'R32',
  '3rd Round': 'R32',
  'Round of 64': 'R64',
  '2nd Round': 'R64',
  'Round of 128': 'R128',
  '1st Round': 'R128',
}

/**
 * Normalize a DSG round name to our internal Round format.
 * Uses exact map first, then substring fallback (same pattern as api-tennis normalizer).
 */
export function normalizeDsgRound(dsgRound: string): Round | null {
  // Try exact map first
  if (DSG_ROUND_MAP[dsgRound]) return DSG_ROUND_MAP[dsgRound]

  // Substring fallback
  const r = dsgRound.toLowerCase().trim()
  if ((r.includes('final') || r === 'f') && !r.includes('semi') && !r.includes('quarter')) return 'F'
  if (r.includes('semi') || r === 'sf') return 'SF'
  if (r.includes('quarter') || r === 'qf') return 'QF'
  if (r.includes('16') || r === 'r16') return 'R16'
  if (r.includes('32') || r === 'r32') return 'R32'
  if (r.includes('64') || r === 'r64') return 'R64'
  if (r.includes('128') || r === 'r128') return 'R128'

  // Unknown round — log warning, return null to skip
  console.warn(`[live-status] Unknown DSG round: "${dsgRound}"`)
  return null
}

// ── Core matching logic ──────────────────────────────────────────────────────

/**
 * Given DSG live matches and our bracket data, find bracket matches
 * that should be auto-locked because they've started.
 *
 * Matching strategy: for each DSG live match —
 *   1. Map DSG player IDs → api-tennis IDs via the verified mapping
 *   2. Normalize DSG round → our Round format
 *   3. Look up bracket match by (sorted player pair + round) key
 *   4. If found and not already locked → include in results
 *
 * Why (player pair + round) is reliable: the same two players never
 * play each other twice in the same round of a tournament.
 */
export function findMatchesToLock(
  dsgMatches: DSGLiveMatch[],
  bracketMatches: DrawMatch[],
  dsgToApiTennisMap: Record<string, string>,  // dsgPlayerId → apiTennisExternalId
  alreadyLocked: Record<string, string>,       // matchId → ISO timestamp
): MatchLockResult[] {
  const results: MatchLockResult[] = []

  // Build index: (sorted player pair + round) → bracket match
  // O(n) build, O(1) per lookup
  const bracketIndex = new Map<string, DrawMatch>()
  for (const m of bracketMatches) {
    const p1 = m.player1?.externalId
    const p2 = m.player2?.externalId
    if (p1 && p2) {
      const key = makeLookupKey(p1, p2, m.round)
      bracketIndex.set(key, m)
    }
  }

  for (const dsgMatch of dsgMatches) {
    // Only interested in live/played statuses
    if (!DSG_LIVE_STATUSES.has(dsgMatch.status)) continue

    // Map DSG player IDs → api-tennis IDs
    const apiId1 = dsgToApiTennisMap[dsgMatch.home_contestant_id]
    const apiId2 = dsgToApiTennisMap[dsgMatch.away_contestant_id]
    if (!apiId1 || !apiId2) {
      // Unmapped players — skip silently (admin needs to verify mapping)
      continue
    }

    // Normalize DSG round
    const round = normalizeDsgRound(dsgMatch.round)
    if (!round) continue  // unknown round, already logged

    // Look up in bracket index
    const key = makeLookupKey(apiId1, apiId2, round)
    const bracketMatch = bracketIndex.get(key)

    if (!bracketMatch) continue                    // no matching bracket match
    if (alreadyLocked[bracketMatch.matchId]) continue  // already locked

    results.push({
      matchId: bracketMatch.matchId,
      dsgMatchId: dsgMatch.match_id,
      reason: dsgMatch.status === 'Played' ? 'played' : 'live',
    })
  }

  return results
}

/** Create a deterministic lookup key from two player IDs and a round */
function makeLookupKey(playerId1: string, playerId2: string, round: string): string {
  return [playerId1, playerId2].sort().join('|') + ':' + round
}
