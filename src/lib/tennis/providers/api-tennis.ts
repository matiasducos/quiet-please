import { TennisProvider } from './base'
import type { Tournament, Draw, MatchResult, Round, TournamentCategory, Tour } from '../types'

const BASE_URL = 'https://tennis-api-atp-wta-itf.p.rapidapi.com/tennis/'

export class ApiTennisProvider extends TennisProvider {
  private async fetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(endpoint, BASE_URL)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

    const res = await fetch(url.toString(), {
      headers: {
        'x-rapidapi-key': this.apiKey,
        'x-rapidapi-host': 'tennis-api-atp-wta-itf.p.rapidapi.com',
      },
      next: { revalidate: 1800 }, // 30 min cache
    })

    if (!res.ok) {
      throw new Error(`api-tennis.com error: ${res.status} ${res.statusText}`)
    }

    return res.json()
  }

  async getUpcomingTournaments(): Promise<Tournament[]> {
    const now = new Date()
    const from = now.toISOString().split('T')[0]
    const to = new Date(now.setMonth(now.getMonth() + 3)).toISOString().split('T')[0]
    return this.getTournaments(from, to)
  }

  async getTournaments(from: string, to: string): Promise<Tournament[]> {
    // api-tennis.com returns tournaments by date range
    const data = await this.fetch<{ result: any[] }>('v1/tournament', { from, to })

    return (data.result ?? [])
      .filter((t: any) => this.isSupportedTour(t.event_type))
      .map((t: any) => this.transformTournament(t))
  }

  async getDraw(tournamentExternalId: string): Promise<Draw> {
    const data = await this.fetch<{ result: any[] }>('v1/tournament/draw', {
      tournament_id: tournamentExternalId,
    })

    const matches = (data.result ?? []).map((m: any) => this.transformMatch(m))
    const rounds = [...new Set(matches.map((m) => m.round))] as Round[]

    return {
      tournamentExternalId,
      rounds,
      matches,
    }
  }

  async getResults(tournamentExternalId: string): Promise<MatchResult[]> {
    const data = await this.fetch<{ result: any[] }>('v1/tournament/results', {
      tournament_id: tournamentExternalId,
    })

    return (data.result ?? [])
      .filter((m: any) => m.winner_id)
      .map((m: any) => this.transformResult(tournamentExternalId, m))
  }

  // --- Transforms ---

  private transformTournament(raw: any): Tournament {
    return {
      externalId:  String(raw.tournament_key ?? raw.id),
      name:        raw.tournament_name ?? raw.name,
      tour:        this.normalizeTour(raw.event_type),
      category:    this.normalizeCategory(raw.event_type, raw.category),
      surface:     this.normalizeSurface(raw.surface),
      drawCloseAt: raw.start_date ?? raw.date_start,
      startsAt:    raw.start_date ?? raw.date_start,
      endsAt:      raw.end_date ?? raw.date_end,
    }
  }

  private transformMatch(raw: any): any {
    return {
      matchId:  String(raw.match_key ?? raw.id),
      round:    this.normalizeRound(raw.round_name ?? raw.round),
      player1:  raw.player1_key ? {
        externalId: String(raw.player1_key),
        name:       raw.player1_name ?? '',
        country:    raw.player1_country ?? '',
        seed:       raw.player1_seed ?? undefined,
      } : null,
      player2:  raw.player2_key ? {
        externalId: String(raw.player2_key),
        name:       raw.player2_name ?? '',
        country:    raw.player2_country ?? '',
        seed:       raw.player2_seed ?? undefined,
      } : null,
      scheduledAt: raw.date ?? raw.scheduled_at,
    }
  }

  private transformResult(tournamentExternalId: string, raw: any): MatchResult {
    return {
      externalMatchId:    String(raw.match_key ?? raw.id),
      tournamentExternalId,
      round:              this.normalizeRound(raw.round_name ?? raw.round),
      winnerExternalId:   String(raw.winner_key ?? raw.winner_id),
      loserExternalId:    String(raw.loser_key ?? raw.loser_id),
      score:              raw.score ?? '',
      playedAt:           raw.date ?? raw.played_at ?? new Date().toISOString(),
    }
  }

  // --- Normalizers ---

  private isSupportedTour(eventType: string): boolean {
    const t = (eventType ?? '').toLowerCase()
    return t.includes('atp') || t.includes('wta')
  }

  private normalizeTour(eventType: string): Tour {
    return (eventType ?? '').toLowerCase().includes('wta') ? 'WTA' : 'ATP'
  }

  private normalizeCategory(eventType: string, category?: string): TournamentCategory {
    const t = ((eventType ?? '') + (category ?? '')).toLowerCase()
    if (t.includes('grand_slam') || t.includes('grand slam')) return 'grand_slam'
    if (t.includes('1000') || t.includes('masters')) return 'masters_1000'
    if (t.includes('500')) return '500'
    return '250'
  }

  private normalizeSurface(surface: string): Tournament['surface'] {
    const s = (surface ?? '').toLowerCase()
    if (s.includes('clay')) return 'clay'
    if (s.includes('grass')) return 'grass'
    return 'hard'
  }

  private normalizeRound(round: string): Round {
    const r = (round ?? '').toLowerCase().replace(/\s/g, '')
    if (r.includes('128') || r.includes('r1')) return 'R128'
    if (r.includes('64')  || r.includes('r2')) return 'R64'
    if (r.includes('32')  || r.includes('r3')) return 'R32'
    if (r.includes('16')  || r.includes('r4')) return 'R16'
    if (r.includes('quarter')) return 'QF'
    if (r.includes('semi'))    return 'SF'
    if (r.includes('final'))   return 'F'
    return 'R32'
  }
}
