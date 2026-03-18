import type { Tournament, Draw, MatchResult } from '../types'

export interface FetchOpts {
  /** ISO date string for the tournament start — used to build the fixtures date range */
  startsAt?: string
  /** ISO date string for the tournament end — used to build the fixtures date range */
  endsAt?: string
}

export abstract class TennisProvider {
  protected apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  abstract getTournaments(from: string, to: string): Promise<Tournament[]>
  abstract getUpcomingTournaments(): Promise<Tournament[]>
  abstract getDraw(tournamentExternalId: string, opts?: FetchOpts): Promise<Draw>
  abstract getResults(tournamentExternalId: string, opts?: FetchOpts): Promise<MatchResult[]>
}
