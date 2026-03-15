import type { Round, TournamentCategory } from './types'

// Official ATP/WTA points per round
// Used by the points engine to score correct predictions
export const POINTS_TABLE: Record<TournamentCategory, Partial<Record<Round, number>>> = {
  grand_slam: {
    R128: 10,
    R64:  45,
    R32:  90,
    R16:  180,
    QF:   360,
    SF:   720,
    F:    1200,
    // W (winner) = 2000 — handled separately
  },
  masters_1000: {
    R128: 10,
    R64:  25,
    R32:  45,
    R16:  90,
    QF:   180,
    SF:   360,
    F:    600,
    // W = 1000
  },
  '500': {
    R32:  20,
    R16:  30,
    QF:   60,
    SF:   90,
    F:    150,
    // W = 500
  },
  '250': {
    R32:  6,
    R16:  13,
    QF:   29,
    SF:   45,
    F:    80,
    // W = 250
  },
}

// Winner points (separate because the round label is 'W' internally)
export const WINNER_POINTS: Record<TournamentCategory, number> = {
  grand_slam:   2000,
  masters_1000: 1000,
  '500':        500,
  '250':        250,
}

export function getPointsForRound(
  category: TournamentCategory,
  round: Round,
  isWinner: boolean
): number {
  if (isWinner && round === 'F') {
    return WINNER_POINTS[category]
  }
  return POINTS_TABLE[category][round] ?? 0
}
