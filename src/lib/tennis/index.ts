import { ApiTennisProvider } from './providers/api-tennis'
import { SportradarProvider } from './providers/sportradar'
import type { TennisProvider } from './providers/base'

function createProvider(): TennisProvider {
  const apiKey = process.env.TENNIS_API_KEY
  if (!apiKey) {
    throw new Error('TENNIS_API_KEY environment variable is not set')
  }

  const provider = process.env.TENNIS_API_PROVIDER ?? 'api-tennis'

  switch (provider) {
    case 'sportradar':
      return new SportradarProvider(apiKey)
    case 'api-tennis':
    default:
      return new ApiTennisProvider(apiKey)
  }
}

export const tennisAdapter = createProvider()

// Re-export types so consumers don't need to import from internal paths
export type {
  Tournament,
  Draw,
  DrawMatch,
  MatchResult,
  Player,
  Round,
  Tour,
  TournamentCategory,
  TournamentStatus,
  Surface,
} from './types'

export { getPointsForRound, POINTS_TABLE, WINNER_POINTS } from './points'
