/**
 * DSG (DataSportsGroup) API client.
 *
 * Supplementary data source layered on top of api-tennis.com.
 * Used for:
 *   - Live match status detection (auto-lock)
 *   - Head-to-head records (replacing mock data)
 *   - Player list (for bootstrapping player ID mapping)
 *
 * NOT a TennisProvider subclass — DSG does not replace api-tennis for
 * tournaments/draws/results; it provides complementary capabilities.
 *
 * ⚠️ IMPORTANT: The exact response shapes from DSG may differ from what's
 * typed here. After activating the trial, hit the API and verify field names.
 * The types below are based on DSG documentation patterns for similar sports.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Raw DSG contestant (player) object from get_contestants / get_peoples */
export interface DSGContestant {
  id: string
  name: string
  nationality?: string
  gender?: string
}

/** Raw DSG match object from get_matches / get_matches_updates */
export interface DSGMatch {
  match_id: string
  competition_id?: string
  season_id?: string
  round?: string            // "Quarter-finals", "Semi-finals", "Final", etc.
  status: string            // "Fixture", "Playing", "Played", "Cancelled", "Suspended", etc.
  home_contestant?: {
    id: string
    name: string
  }
  away_contestant?: {
    id: string
    name: string
  }
  start_time?: string       // ISO datetime or DSG format
  score?: string
}

/** Raw DSG H2H data from get_head2head */
export interface DSGH2HResponse {
  contestant1?: { id: string; name: string }
  contestant2?: { id: string; name: string }
  matches?: Array<{
    date?: string
    competition_name?: string
    surface?: string
    round?: string
    winner_id?: string
    score?: string
  }>
}

/** Raw DSG competition object from get_competitions */
export interface DSGCompetition {
  id: string
  name: string
  type?: string
}

// ── Client ───────────────────────────────────────────────────────────────────

const DSG_BASE = 'https://dsg-api.com/clients'

export class DSGClient {
  private clientId: string
  private authKey: string

  constructor(clientId: string, authKey: string) {
    this.clientId = clientId
    this.authKey = authKey
  }

  /**
   * Core fetcher. DSG auth uses query params (not headers).
   * Default format is JSON (ftype=json).
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

    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`DSG HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`)
    }

    return res.json() as Promise<T>
  }

  // ── Match Status ─────────────────────────────────────────────────────────

  /**
   * Fetch all matches for a DSG competition.
   * Used by the live-status cron to detect started matches.
   */
  async getMatchesByCompetition(competitionId: string): Promise<DSGMatch[]> {
    const data = await this.fetch<any>('get_matches', {
      competition_id: competitionId,
    })
    // DSG response envelopes vary — try common patterns
    return extractArray<DSGMatch>(data, ['matches', 'match', 'data'])
  }

  /**
   * Fetch recent match updates (delta since N minutes ago).
   * More efficient than fetching all matches for frequent polling.
   */
  async getMatchUpdates(sinceMinutes: number = 5): Promise<DSGMatch[]> {
    const data = await this.fetch<any>('get_matches_updates', {
      minutes: String(sinceMinutes),
    })
    return extractArray<DSGMatch>(data, ['matches', 'match', 'data'])
  }

  // ── Head-to-Head ─────────────────────────────────────────────────────────

  /**
   * Fetch H2H record between two players by their DSG IDs.
   * Used to replace the mock H2H in h2h.ts.
   */
  async getH2H(player1DsgId: string, player2DsgId: string): Promise<DSGH2HResponse> {
    const data = await this.fetch<any>('get_head2head', {
      contestant1_id: player1DsgId,
      contestant2_id: player2DsgId,
    })
    return data as DSGH2HResponse
  }

  // ── Contestants (Players) ────────────────────────────────────────────────

  /**
   * Fetch the full player list from DSG.
   * Used to bootstrap the player_id_map table.
   */
  async getContestants(opts?: { gender?: 'male' | 'female' }): Promise<DSGContestant[]> {
    const params: Record<string, string> = {}
    if (opts?.gender) params.gender = opts.gender
    const data = await this.fetch<any>('get_contestants', params)
    return extractArray<DSGContestant>(data, ['contestants', 'contestant', 'peoples', 'data'])
  }

  // ── Competitions (Tournaments) ───────────────────────────────────────────

  /**
   * Fetch the list of DSG competitions.
   * Used for admin mapping of tournament → DSG competition ID.
   */
  async getCompetitions(): Promise<DSGCompetition[]> {
    const data = await this.fetch<any>('get_competitions')
    return extractArray<DSGCompetition>(data, ['competitions', 'competition', 'data'])
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * DSG wraps data in different envelope keys depending on the endpoint.
 * Try multiple common keys and return the first array found.
 */
function extractArray<T>(data: any, keys: string[]): T[] {
  if (Array.isArray(data)) return data
  for (const key of keys) {
    const val = data?.[key]
    if (Array.isArray(val)) return val
    // Sometimes DSG returns a single object instead of an array
    if (val && typeof val === 'object' && !Array.isArray(val)) return [val] as T[]
  }
  // Last resort: if data itself is an object with numeric keys, try Object.values
  return []
}

// ── Singleton factory ────────────────────────────────────────────────────────

let _client: DSGClient | null = null

/**
 * Get or create the DSG client singleton.
 * Reads DSG_CLIENT_ID and DSG_AUTH_KEY from environment.
 * Throws if credentials are missing.
 */
export function getDSGClient(): DSGClient {
  if (_client) return _client
  const clientId = process.env.DSG_CLIENT_ID
  const authKey = process.env.DSG_AUTH_KEY
  if (!clientId || !authKey) {
    throw new Error('DSG_CLIENT_ID and DSG_AUTH_KEY environment variables are required')
  }
  _client = new DSGClient(clientId, authKey)
  return _client
}

/**
 * Check if DSG credentials are configured.
 * Use this for graceful degradation (e.g., fall back to mock H2H).
 */
export function isDSGConfigured(): boolean {
  return !!(process.env.DSG_CLIENT_ID && process.env.DSG_AUTH_KEY)
}
