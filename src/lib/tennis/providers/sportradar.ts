import { TennisProvider } from './base'
import type { Tournament, Draw, MatchResult } from '../types'

// Sportradar Tennis v3 — implement when upgrading from api-tennis.com
// Docs: https://developer.sportradar.com/tennis/reference/overview
export class SportradarProvider extends TennisProvider {
  async getUpcomingTournaments(): Promise<Tournament[]> {
    throw new Error('SportradarProvider not yet implemented. Set TENNIS_API_PROVIDER=api-tennis to use the current provider.')
  }

  async getTournaments(_from: string, _to: string): Promise<Tournament[]> {
    throw new Error('SportradarProvider not yet implemented.')
  }

  async getDraw(_tournamentExternalId: string): Promise<Draw> {
    throw new Error('SportradarProvider not yet implemented.')
  }

  async getResults(_tournamentExternalId: string): Promise<MatchResult[]> {
    throw new Error('SportradarProvider not yet implemented.')
  }
}
