import type { Tournament, Draw, MatchResult } from '../types'

export abstract class TennisProvider {
  protected apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  abstract getTournaments(from: string, to: string): Promise<Tournament[]>
  abstract getUpcomingTournaments(): Promise<Tournament[]>
  abstract getDraw(tournamentExternalId: string): Promise<Draw>
  abstract getResults(tournamentExternalId: string): Promise<MatchResult[]>
}
