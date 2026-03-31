/**
 * Player ID mapping between api-tennis.com and DSG.
 *
 * Provides fuzzy name matching for bootstrapping the mapping table,
 * plus DB helpers for looking up verified mappings at runtime.
 */

import { createAdminClient } from '@/lib/supabase/admin'

// ── Name normalization ───────────────────────────────────────────────────────

/** Normalize a player name for comparison: lowercase, strip accents, strip non-alpha */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')        // keep only letters, spaces, hyphens
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Levenshtein distance ─────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  // Use single-row optimization for memory efficiency
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  const curr = new Array(n + 1)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1])
    }
    // Swap rows
    const tmp = prev
    prev = curr.slice()
    // reuse curr buffer next iteration
    void tmp
  }

  return prev[n]
}

// ── Name similarity scoring ──────────────────────────────────────────────────

/**
 * Compute similarity between two player names (0–1).
 * Uses token-sorted comparison to handle name-order variations
 * ("Carlos Alcaraz" ↔ "Alcaraz Carlos").
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)

  // Exact match after normalization
  if (na === nb) return 1.0

  // Token-sorted: sort words alphabetically and compare
  const tokensA = na.split(' ').sort()
  const tokensB = nb.split(' ').sort()
  const sortedA = tokensA.join(' ')
  const sortedB = tokensB.join(' ')

  if (sortedA === sortedB) return 0.98

  // Check if one is a substring of the other (handles partial names)
  if (sortedA.includes(sortedB) || sortedB.includes(sortedA)) return 0.90

  // Levenshtein-based similarity on sorted tokens
  const maxLen = Math.max(sortedA.length, sortedB.length)
  if (maxLen === 0) return 1.0

  const dist = levenshtein(sortedA, sortedB)
  return Math.max(0, 1 - dist / maxLen)
}

// ── Mapping types ────────────────────────────────────────────────────────────

export interface PlayerMappingCandidate {
  apiTennisId: string
  apiTennisName: string
  apiTennisCountry: string
  dsgPlayerId: string
  dsgName: string
  dsgCountry: string
  score: number             // 0-1 combined similarity
  method: 'exact' | 'fuzzy'
}

export interface ApiTennisPlayer {
  id: string
  name: string
  country: string
}

export interface DSGPlayer {
  id: string
  name: string
  nationality: string
}

// ── Bootstrap: generate candidate matches ────────────────────────────────────

/**
 * Match api-tennis players to DSG players by name + nationality.
 * Returns sorted candidates (highest confidence first).
 *
 * For each api-tennis player, finds the best-matching DSG player.
 * Only includes matches with score >= 0.70.
 */
export function generateMappingCandidates(
  apiTennisPlayers: ApiTennisPlayer[],
  dsgPlayers: DSGPlayer[],
): PlayerMappingCandidate[] {
  const candidates: PlayerMappingCandidate[] = []

  // Pre-normalize DSG names for faster inner loop
  const dsgNormalized = dsgPlayers.map(p => ({
    ...p,
    normalizedName: normalizeName(p.name),
    normalizedCountry: (p.nationality ?? '').toLowerCase().trim(),
  }))

  for (const at of apiTennisPlayers) {
    let bestMatch: PlayerMappingCandidate | null = null
    let bestScore = 0

    const atNormCountry = (at.country ?? '').toLowerCase().trim()

    for (const dsg of dsgNormalized) {
      const nameScore = nameSimilarity(at.name, dsg.name)

      // Country match gives a small boost (helps disambiguate same-name players)
      const countryMatch =
        atNormCountry && dsg.normalizedCountry &&
        (atNormCountry === dsg.normalizedCountry ||
         atNormCountry.includes(dsg.normalizedCountry) ||
         dsg.normalizedCountry.includes(atNormCountry))

      const countryBoost = countryMatch ? 0.05 : 0
      const totalScore = Math.min(nameScore + countryBoost, 1.0)

      if (totalScore > bestScore) {
        bestScore = totalScore
        bestMatch = {
          apiTennisId: at.id,
          apiTennisName: at.name,
          apiTennisCountry: at.country,
          dsgPlayerId: dsg.id,
          dsgName: dsg.name,
          dsgCountry: dsg.nationality,
          score: totalScore,
          method: totalScore >= 0.95 ? 'exact' : 'fuzzy',
        }
      }
    }

    if (bestMatch && bestScore >= 0.70) {
      candidates.push(bestMatch)
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

// ── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Look up a single player's DSG ID by their api-tennis ID.
 * Only returns verified mappings.
 */
export async function getPlayerDsgId(apiTennisId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('player_id_map')
    .select('dsg_player_id')
    .eq('api_tennis_id', apiTennisId)
    .eq('verified', true)
    .single()

  if (error || !data) return null
  return data.dsg_player_id
}

/**
 * Bulk-load the reverse mapping: DSG player ID → api-tennis ID.
 * Only includes verified mappings.
 * Used by the live-status cron for efficient batch lookups.
 */
export async function getDsgToApiTennisMap(): Promise<Record<string, string>> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('player_id_map')
    .select('api_tennis_id, dsg_player_id')
    .eq('verified', true)

  if (error || !data) return {}

  const map: Record<string, string> = {}
  for (const row of data) {
    map[row.dsg_player_id] = row.api_tennis_id
  }
  return map
}

/**
 * Bulk-load the forward mapping: api-tennis ID → DSG player ID.
 * Only includes verified mappings.
 * Used by H2H lookups.
 */
export async function getApiTennisToDsgMap(): Promise<Record<string, string>> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('player_id_map')
    .select('api_tennis_id, dsg_player_id')
    .eq('verified', true)

  if (error || !data) return {}

  const map: Record<string, string> = {}
  for (const row of data) {
    map[row.api_tennis_id] = row.dsg_player_id
  }
  return map
}
