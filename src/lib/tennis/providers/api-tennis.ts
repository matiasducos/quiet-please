import { TennisProvider, type FetchOpts } from './base'
import type { Tournament, Draw, DrawMatch, MatchResult, Round, TournamentCategory, Tour } from '../types'

// Direct api-tennis.com API (not the RapidAPI wrapper)
// Docs: https://api-tennis.com/documentation
const BASE_URL = 'https://api.api-tennis.com/tennis/'

/** Decode common HTML entities the Tennis API sometimes encodes in player names */
function decodeEntities(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

// Add days to a YYYY-MM-DD string and return YYYY-MM-DD
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Fallback look-ahead window when tournament end date is unknown
const DEFAULT_WINDOW_DAYS = 21

export class ApiTennisProvider extends TennisProvider {

  // ── Core fetcher ─────────────────────────────────────────────────────────

  private async fetchApi<T>(params: Record<string, string>): Promise<T> {
    const url = new URL(BASE_URL)
    // Auth is a query param — NOT a header
    url.searchParams.set('APIkey', this.apiKey)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }

    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`api-tennis HTTP ${res.status} ${res.statusText} — ${body}`)
    }

    const json = await res.json()
    // Response envelope: { success: 1, result: [...] } or { success: 0, error: '...' }
    if (!json.success) {
      throw new Error(`api-tennis API error: ${json.error ?? JSON.stringify(json)}`)
    }
    return (json.result ?? []) as T
  }

  // ── Tournament list ──────────────────────────────────────────────────────

  async getUpcomingTournaments(): Promise<Tournament[]> {
    const data = await this.fetchApi<any[]>({ method: 'get_tournaments' })
    return (data ?? []).flatMap(t => this.transformTournament(t))
  }

  async getTournaments(_from: string, _to: string): Promise<Tournament[]> {
    // api-tennis.com's get_tournaments returns all known tournaments without
    // date filtering. Fixture data (with dates) comes via getDraw/getResults.
    return this.getUpcomingTournaments()
  }

  // ── Draw (all fixtures for a tournament, including not-yet-played) ───────

  async getDraw(tournamentExternalId: string, opts?: FetchOpts): Promise<Draw> {
    const fixtures = await this.fetchFixtures(tournamentExternalId, opts)
    if (!fixtures.length) {
      return { tournamentExternalId, rounds: [], matches: [] }
    }

    const matches: DrawMatch[] = fixtures.map(f => this.transformMatch(f))
    // Preserve unique rounds in order they appear
    const roundSet = new Set(matches.map(m => m.round))
    const rounds = [...roundSet] as Round[]
    return { tournamentExternalId, rounds, matches }
  }

  // ── Results (completed matches only) ────────────────────────────────────

  async getResults(tournamentExternalId: string, opts?: FetchOpts): Promise<MatchResult[]> {
    const fixtures = await this.fetchFixtures(tournamentExternalId, opts)
    return fixtures
      .filter(f => f.event_winner && f.event_winner !== '')
      .map(f => this.transformResult(tournamentExternalId, f))
  }

  // ── Internal: fetch fixtures for a tournament over its date range ────────

  private async fetchFixtures(tournamentKey: string, opts?: FetchOpts): Promise<any[]> {
    const today = new Date().toISOString().slice(0, 10)
    // If we know when the tournament starts, use that; otherwise fall back to today
    const dateStart = opts?.startsAt ? opts.startsAt.slice(0, 10) : today
    // Add 1 day beyond end so the final-day matches are included; if no end date, use a 21-day window
    const dateStop = opts?.endsAt
      ? addDays(opts.endsAt.slice(0, 10), 1)
      : addDays(dateStart, DEFAULT_WINDOW_DAYS)

    try {
      return await this.fetchApi<any[]>({
        method:         'get_fixtures',
        tournament_key: tournamentKey,
        date_start:     dateStart,
        date_stop:      dateStop,
      })
    } catch (err) {
      console.warn(`[api-tennis] fetchFixtures failed for tournament ${tournamentKey}:`, err)
      return []
    }
  }

  // ── Transform raw API shapes to internal types ────────────────────────────

  private transformTournament(raw: any): Tournament[] {
    const tour = this.normalizeTour(raw.event_type_type ?? '')
    if (!tour) return []  // Skip ITF, Challenger, Doubles, etc.

    // The API may return a tournament_date for the start of the event
    const startsAt = raw.tournament_date
      ? new Date(raw.tournament_date).toISOString()
      : new Date().toISOString()

    return [{
      externalId:  String(raw.tournament_key),
      name:        raw.tournament_name ?? 'Unknown Tournament',
      tour,
      category:    this.normalizeCategory(raw.tournament_name ?? ''),
      surface:     null,  // api-tennis.com returns no surface data — set manually in admin panel
      drawCloseAt: startsAt,
      startsAt,
      endsAt:      startsAt,
    }]
  }

  private transformMatch(raw: any): DrawMatch {
    return {
      matchId:     String(raw.event_key),
      round:       this.normalizeRound(raw.tournament_round ?? ''),
      player1:     raw.event_home_team ? {
        externalId: String(raw.event_home_team_key ?? raw.event_home_team),
        name:       decodeEntities(String(raw.event_home_team)),
        country:    decodeEntities(String(raw.event_home_team_country ?? '')),
      } : null,
      player2:     raw.event_away_team ? {
        externalId: String(raw.event_away_team_key ?? raw.event_away_team),
        name:       decodeEntities(String(raw.event_away_team)),
        country:    decodeEntities(String(raw.event_away_team_country ?? '')),
      } : null,
      scheduledAt: raw.event_date ?? undefined,
    }
  }

  private transformResult(tournamentExternalId: string, raw: any): MatchResult {
    // event_winner is "First Player" (home wins) or "Second Player" (away wins)
    const player1Won =
      raw.event_winner === 'First Player' ||
      raw.event_winner?.toLowerCase?.() === 'first player'

    return {
      externalMatchId:     String(raw.event_key),
      tournamentExternalId,
      round:               this.normalizeRound(raw.tournament_round ?? ''),
      winnerExternalId:    String(player1Won ? raw.event_home_team_key : raw.event_away_team_key),
      loserExternalId:     String(player1Won ? raw.event_away_team_key : raw.event_home_team_key),
      score:               raw.event_final_result ?? '',
      playedAt:            raw.event_date ?? new Date().toISOString(),
    }
  }

  // ── Normalizers ──────────────────────────────────────────────────────────

  private normalizeRound(round: string): Round {
    const r = round.toLowerCase().trim()
    if (r === 'final' || r === 'the final')              return 'F'
    if (r.includes('semi'))                               return 'SF'
    if (r.includes('quarter'))                            return 'QF'
    if (r === '1/8'  || r.includes('16'))                return 'R16'
    if (r === '1/16' || r.includes('32'))                return 'R32'
    if (r === '1/32' || r.includes('64'))                return 'R64'
    if (r === '1/64' || r.includes('128'))               return 'R128'
    console.warn(`[api-tennis] Unknown tournament_round "${round}", defaulting to R32`)
    return 'R32'
  }

  private normalizeTour(type: string): Tour | null {
    const t = (type ?? '').toUpperCase()
    // Exclude doubles and challenger events
    if (t.includes('ATP') && !t.includes('CHALLENGER') && !t.includes('DOUBLES')) return 'ATP'
    if (t.includes('WTA') && !t.includes('DOUBLES'))                               return 'WTA'
    return null
  }

  private normalizeCategory(tournamentName: string): TournamentCategory {
    const n = (tournamentName ?? '').toLowerCase()

    const grandSlams = ['australian open', 'roland garros', 'french open', 'wimbledon', 'us open']
    if (grandSlams.some(g => n.includes(g))) return 'grand_slam'

    const masters = [
      // ATP Masters 1000
      'indian wells', 'bnp paribas open',
      'miami open',
      'monte-carlo', 'monte carlo',
      'madrid open', 'mutua madrid',
      'italian open', 'internazionali bnl', 'internazionali d\'italia', 'rome masters',
      'canadian open', 'rogers cup', 'national bank open',
      'western & southern', 'cincinnati',
      'shanghai', 'rolex shanghai',
      'paris masters', 'rolex paris',
      // WTA 1000 equivalents
      'china open', 'beijing open',
      'wuhan open',
      'guadalajara wta',
    ]
    if (masters.some(m => n.includes(m))) return 'masters_1000'

    const fiveHundred = [
      // ATP 500
      'abn amro', 'rotterdam',
      'dubai',
      'acapulco', 'open mexicano',
      'barcelona open', 'banc sabadell',
      "queen's club", 'cinch championships',
      'terra wortmann', 'halle open',
      'citi open', 'washington open',
      'erste bank', 'vienna open',
      'swiss indoors', 'basel open',
      // WTA 500
      'ostrava open',
      'linz open',
      'mubadala abu dhabi',
      'bad homburg',
    ]
    if (fiveHundred.some(f => n.includes(f))) return '500'

    return '250'
  }
}
