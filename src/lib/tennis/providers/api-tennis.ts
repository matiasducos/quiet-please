import { TennisProvider } from './base'
import type { Tournament, Draw, MatchResult, Round, TournamentCategory, Tour } from '../types'

const RAPIDAPI_HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export class ApiTennisProvider extends TennisProvider {

  private async fetch<T>(path: string): Promise<T> {
    const url = `https://${RAPIDAPI_HOST}/${path}`
    const res = await fetch(url, {
      headers: {
        'x-rapidapi-key':  this.apiKey,
        'x-rapidapi-host': RAPIDAPI_HOST,
        'Content-Type':    'application/json',
      },
      next: { revalidate: 1800 },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`api-tennis error: ${res.status} ${res.statusText} — ${body}`)
    }
    return res.json()
  }

  async getUpcomingTournaments(): Promise<Tournament[]> {
    const year = new Date().getFullYear()
    return this.getTournamentsByYear(year)
  }

  async getTournaments(from: string, to: string): Promise<Tournament[]> {
    const year = new Date(from).getFullYear()
    const all = await this.getTournamentsByYear(year)
    return all.filter(t => t.startsAt >= from && t.startsAt <= to)
  }

  private async getTournamentsByYear(year: number): Promise<Tournament[]> {
    const tournaments: Tournament[] = []

    // Sequential requests with delay to avoid rate limiting on free tier
    const atpData = await this.fetch<{ data: any[] }>(`tennis/v2/atp/tournament/calendar/${year}`)
    for (const item of (atpData.data ?? [])) {
      tournaments.push(this.transformCalendarTournament(item, 'ATP'))
    }

    await delay(500) // 500ms between ATP and WTA calls

    const wtaData = await this.fetch<{ data: any[] }>(`tennis/v2/wta/tournament/calendar/${year}`)
    for (const item of (wtaData.data ?? [])) {
      tournaments.push(this.transformCalendarTournament(item, 'WTA'))
    }

    return tournaments
  }

  async getDraw(tournamentExternalId: string): Promise<Draw> {
    for (const type of ['atp', 'wta']) {
      try {
        const data = await this.fetch<{ data: any[]; hasNextPage: boolean }>(
          `tennis/v2/${type}/fixtures/tournament/${tournamentExternalId}`
        )
        if (data.data?.length) {
          const matches = data.data.map((m: any) => this.transformMatch(m))
          const rounds = [...new Set(matches.map(m => m.round))] as Round[]
          return { tournamentExternalId, rounds, matches }
        }
        await delay(300)
      } catch { await delay(300) }
    }
    return { tournamentExternalId, rounds: [], matches: [] }
  }

  async getResults(tournamentExternalId: string): Promise<MatchResult[]> {
    for (const type of ['atp', 'wta']) {
      try {
        const data = await this.fetch<{ data: any[] }>(
          `tennis/v2/${type}/fixtures/tournament/${tournamentExternalId}`
        )
        if (data.data?.length) {
          return data.data
            .filter((m: any) => m.winner !== null && m.winner !== undefined)
            .map((m: any) => this.transformResult(tournamentExternalId, m))
        }
        await delay(300)
      } catch { await delay(300) }
    }
    return []
  }

  private transformCalendarTournament(raw: any, tour: Tour): Tournament {
    return {
      externalId:  String(raw.id),
      name:        raw.name ?? 'Unknown Tournament',
      tour,
      category:    this.normalizeCategory(raw.round?.name ?? '', raw.rankId),
      surface:     this.normalizeSurface(raw.court?.name ?? ''),
      drawCloseAt: raw.date ?? new Date().toISOString(),
      startsAt:    raw.date ?? new Date().toISOString(),
      endsAt:      raw.date ?? new Date().toISOString(),
    }
  }

  private transformMatch(raw: any): any {
    return {
      matchId:     String(raw.id),
      round:       this.normalizeRoundId(raw.roundId ?? 0),
      player1:     raw.player1 ? {
        externalId: String(raw.player1.id),
        name:       raw.player1.name ?? '',
        country:    raw.player1.countryAcr ?? '',
      } : null,
      player2:     raw.player2 ? {
        externalId: String(raw.player2.id),
        name:       raw.player2.name ?? '',
        country:    raw.player2.countryAcr ?? '',
      } : null,
      scheduledAt: raw.date,
    }
  }

  private transformResult(tournamentExternalId: string, raw: any): MatchResult {
    const homeWon = raw.winner === 1 || raw.winner === 'player1'
    return {
      externalMatchId:     String(raw.id),
      tournamentExternalId,
      round:               this.normalizeRoundId(raw.roundId ?? 0),
      winnerExternalId:    String(homeWon ? raw.player1?.id : raw.player2?.id),
      loserExternalId:     String(homeWon ? raw.player2?.id : raw.player1?.id),
      score:               raw.score ?? '',
      playedAt:            raw.date ?? new Date().toISOString(),
    }
  }

  private normalizeRoundId(roundId: number): Round {
    switch (roundId) {
      case 1: return 'F'
      case 2: return 'SF'
      case 3: return 'QF'
      case 4: return 'R16'
      case 5: return 'R32'
      case 6: return 'R64'
      case 7: return 'R128'
      default: return 'R32'
    }
  }

  private normalizeCategory(roundName: string, rankId?: number): TournamentCategory {
    if (rankId === 1 || roundName.toLowerCase().includes('grand slam')) return 'grand_slam'
    if (rankId === 3 || roundName.toLowerCase().includes('masters series')) return 'masters_1000'
    if (roundName.toLowerCase().includes('500')) return '500'
    return '250'
  }

  private normalizeSurface(courtName: string): Tournament['surface'] {
    const c = courtName.toLowerCase()
    if (c.includes('clay')) return 'clay'
    if (c.includes('grass')) return 'grass'
    return 'hard'
  }
}