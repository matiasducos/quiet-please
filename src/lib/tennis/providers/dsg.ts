/**
 * DSG (DataSportsGroup) API client.
 *
 * Supplementary data source layered on top of api-tennis.com.
 * Used for:
 *   - Live match status detection (auto-lock)
 *   - Player list extraction (for bootstrapping player ID mapping)
 *
 * NOT a TennisProvider subclass — DSG does not replace api-tennis for
 * tournaments/draws/results; it provides complementary capabilities.
 *
 * Auth: DSG uses 3 layers:
 *   Layer 1: `client` + `authkey` query params
 *   Layer 2: HTTP Basic Auth (username + password)
 *   Layer 3: Domain/IP whitelisting (managed by DSG)
 *
 * Available endpoints (trial subscription):
 *   ✅ get_matches          — full tournament matches (deeply nested)
 *   ✅ get_matches_updates  — recent match changes (flat, preferred for polling)
 *   ✅ get_competitions     — tournament list
 *   ❌ get_head2head        — unauthorized on current plan
 *   ❌ get_contestants      — unauthorized on current plan
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Flat DSG match object (from get_matches and get_matches_updates) */
export interface DSGMatch {
  match_id: string
  date?: string               // "2026-03-31"
  time?: string               // "21:00:00"  (CET)
  date_utc?: string           // "2026-03-31"
  time_utc?: string           // "19:00:00"
  contestant_a_id: string
  contestant_a_common_name?: string
  contestant_a_short_name?: string
  contestant_a_first_name?: string
  contestant_a_last_name?: string
  contestant_a_nationality_area_name?: string
  contestant_a_nationality_area_code?: string
  contestant_a_seeding?: string
  contestant_b_id: string
  contestant_b_common_name?: string
  contestant_b_short_name?: string
  contestant_b_first_name?: string
  contestant_b_last_name?: string
  contestant_b_nationality_area_name?: string
  contestant_b_nationality_area_code?: string
  contestant_b_seeding?: string
  status: string              // "Fixture" | "Playing" | "Played" | "Cancelled" | "Suspended" etc.
  winner?: string             // "contestant_a" | "contestant_b" | "yet unknown"
  score_a?: string
  score_b?: string
  final_period?: string
  last_updated?: string       // "2026-03-31 23:25:33"
  match_extra?: DSGMatchExtra
}

/** Nested extra info on get_matches_updates responses */
export interface DSGMatchExtra {
  competition?: {
    competition_id: string
    competition_name?: string
  }
  season?: {
    season_id: string
    season_name?: string
    season_title?: string
  }
  round?: {
    round_id: string
    round_name: string        // "Round of 32", "Quarter-finals", etc.
  }
  venue?: {
    venue_id?: string
    venue_name?: string
    venue_city?: string
  }
}

/** DSG competition from get_competitions */
export interface DSGCompetition {
  competition_id: string
  name: string
  gender?: string
  type?: string
  format?: string
  area_id?: string
  area_name?: string
}

/** Extracted player info from match data (used for bootstrap when get_contestants is unavailable) */
export interface DSGPlayerFromMatch {
  id: string
  name: string                // common_name
  nationality: string         // nationality_area_name
  nationalityCode: string     // nationality_area_code (e.g., "USA")
}

// ── Client ───────────────────────────────────────────────────────────────────

const DSG_BASE = 'https://dsg-api.com/clients'

export class DSGClient {
  private clientId: string
  private authKey: string
  private password: string

  constructor(clientId: string, authKey: string, password: string) {
    this.clientId = clientId
    this.authKey = authKey
    this.password = password
  }

  /**
   * Core fetcher. DSG uses two auth layers:
   *   Layer 1: client + authkey as query params
   *   Layer 2: HTTP Basic Auth header
   */
  private async fetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${DSG_BASE}/${this.clientId}/tennis/${endpoint}`)
    url.searchParams.set('client', this.clientId)
    url.searchParams.set('authkey', this.authKey)
    url.searchParams.set('ftype', 'json')
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v)
      }
    }

    const basicAuth = Buffer.from(`${this.clientId}:${this.password}`).toString('base64')

    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Authorization': `Basic ${basicAuth}`,
      },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`DSG HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`)
    }

    const json = await res.json() as any

    // DSG returns errors as { "Error": "message" }
    if (json?.Error) {
      throw new Error(`DSG API error: ${json.Error}`)
    }

    return json as T
  }

  // ── Match Updates (preferred for polling — flat response) ─────────────────

  /**
   * Fetch recent match updates across all competitions (delta).
   * Returns a flat array — much simpler than get_matches.
   *
   * Response path: datasportsgroup.match[]
   */
  async getMatchUpdates(sinceMinutes: number = 5): Promise<DSGMatch[]> {
    const data = await this.fetch<any>('get_matches_updates', {
      minutes: String(sinceMinutes),
    })
    const matches = data?.datasportsgroup?.match
    if (Array.isArray(matches)) return matches
    if (matches && typeof matches === 'object') return [matches]
    return []
  }

  // ── Full Match List (deeply nested — use for bootstrap/full sync) ─────────

  /**
   * Fetch all matches for a season (tournament edition).
   *
   * NOTE: The response is deeply nested:
   *   datasportsgroup.tour.tour_season.competition.season
   *     .discipline[].gender.round[].list.match[]
   *
   * Use getMatchUpdates() for live polling instead — it's flatter and more efficient.
   */
  async getMatchesBySeason(seasonId: string): Promise<DSGMatch[]> {
    const data = await this.fetch<any>('get_matches', {
      type: 'season',
      id: seasonId,
    })
    return extractMatchesFromSeasonResponse(data)
  }

  // ── Competitions ──────────────────────────────────────────────────────────

  /**
   * Fetch available DSG competitions (tournaments).
   * Response path: datasportsgroup.competition[]
   */
  async getCompetitions(): Promise<DSGCompetition[]> {
    const data = await this.fetch<any>('get_competitions')
    const comps = data?.datasportsgroup?.competition
    if (Array.isArray(comps)) return comps
    if (comps && typeof comps === 'object') return [comps]
    return []
  }

  // ── Player extraction from match data ─────────────────────────────────────

  /**
   * Extract unique players from match update data.
   * Workaround for get_contestants being unauthorized on current plan.
   *
   * Call with a large sinceMinutes (e.g., 10080 = 7 days) to get
   * players from all recently active matches.
   */
  async getPlayersFromRecentMatches(sinceMinutes: number = 10080): Promise<DSGPlayerFromMatch[]> {
    const matches = await this.getMatchUpdates(sinceMinutes)
    return extractUniquePlayersFromMatches(matches)
  }
}

// ── Response extractors ─────────────────────────────────────────────────────

/**
 * Extract matches from the deeply nested get_matches?type=season response.
 *
 * Path: datasportsgroup.tour.tour_season.competition.season
 *         .discipline[].gender.round[].list.match[]
 *
 * We also inject round info from the parent round node into each match's
 * match_extra (since the full-match response doesn't include it inline).
 */
function extractMatchesFromSeasonResponse(data: any): DSGMatch[] {
  const matches: DSGMatch[] = []

  try {
    const season = data?.datasportsgroup?.tour?.tour_season?.competition?.season
    if (!season) return []

    const disciplines = Array.isArray(season.discipline)
      ? season.discipline
      : season.discipline ? [season.discipline] : []

    for (const disc of disciplines) {
      // gender can be an object with round[] directly
      const gender = disc?.gender
      if (!gender) continue

      const rounds = Array.isArray(gender.round)
        ? gender.round
        : gender.round ? [gender.round] : []

      for (const round of rounds) {
        const roundName = round?.name ?? ''
        const roundId = round?.round_id ?? ''

        // list.match contains the actual matches
        const list = round?.list
        const rawMatches = list?.match
        if (!rawMatches) continue

        const matchArray = Array.isArray(rawMatches) ? rawMatches : [rawMatches]

        for (const m of matchArray) {
          // Inject round info into match_extra if not already present
          if (!m.match_extra) m.match_extra = {}
          if (!m.match_extra.round) {
            m.match_extra.round = { round_id: roundId, round_name: roundName }
          }
          matches.push(m as DSGMatch)
        }
      }
    }
  } catch (err) {
    console.error('[dsg] Failed to extract matches from season response:', err)
  }

  return matches
}

/**
 * Extract unique players from a flat array of DSG matches.
 * Deduplicates by contestant ID.
 */
export function extractUniquePlayersFromMatches(matches: DSGMatch[]): DSGPlayerFromMatch[] {
  const seen = new Map<string, DSGPlayerFromMatch>()

  for (const m of matches) {
    if (m.contestant_a_id && !seen.has(m.contestant_a_id)) {
      seen.set(m.contestant_a_id, {
        id: m.contestant_a_id,
        name: m.contestant_a_common_name ?? `${m.contestant_a_first_name ?? ''} ${m.contestant_a_last_name ?? ''}`.trim(),
        nationality: m.contestant_a_nationality_area_name ?? '',
        nationalityCode: m.contestant_a_nationality_area_code ?? '',
      })
    }
    if (m.contestant_b_id && !seen.has(m.contestant_b_id)) {
      seen.set(m.contestant_b_id, {
        id: m.contestant_b_id,
        name: m.contestant_b_common_name ?? `${m.contestant_b_first_name ?? ''} ${m.contestant_b_last_name ?? ''}`.trim(),
        nationality: m.contestant_b_nationality_area_name ?? '',
        nationalityCode: m.contestant_b_nationality_area_code ?? '',
      })
    }
  }

  return Array.from(seen.values())
}

// ── Singleton factory ────────────────────────────────────────────────────────

let _client: DSGClient | null = null

/**
 * Get or create the DSG client singleton.
 * Reads DSG_CLIENT_ID, DSG_AUTH_KEY, and DSG_PASSWORD from environment.
 * Throws if credentials are missing.
 */
export function getDSGClient(): DSGClient {
  if (_client) return _client
  const clientId = process.env.DSG_CLIENT_ID
  const authKey = process.env.DSG_AUTH_KEY
  const password = process.env.DSG_PASSWORD
  if (!clientId || !authKey || !password) {
    throw new Error('DSG_CLIENT_ID, DSG_AUTH_KEY, and DSG_PASSWORD environment variables are required')
  }
  _client = new DSGClient(clientId, authKey, password)
  return _client
}

/**
 * Check if DSG credentials are configured.
 * Use this for graceful degradation (e.g., fall back to mock H2H).
 */
export function isDSGConfigured(): boolean {
  return !!(process.env.DSG_CLIENT_ID && process.env.DSG_AUTH_KEY && process.env.DSG_PASSWORD)
}
