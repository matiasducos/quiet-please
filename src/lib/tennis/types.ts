export type Tour = 'ATP' | 'WTA'
export type Surface = 'hard' | 'clay' | 'grass'
export type TournamentCategory = 'grand_slam' | 'masters_1000' | '500' | '250'
export type Round = 'R128' | 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'
export type TournamentStatus = 'upcoming' | 'accepting_predictions' | 'in_progress' | 'completed'

export interface Player {
  externalId: string
  name: string
  country: string
  ranking?: number
  seed?: number
}

export interface DrawMatch {
  matchId: string
  round: Round
  player1: Player | null  // null = TBD
  player2: Player | null
  scheduledAt?: string
}

export interface Draw {
  tournamentExternalId: string
  rounds: Round[]
  matches: DrawMatch[]
}

export interface Tournament {
  externalId: string
  name: string
  tour: Tour
  category: TournamentCategory
  surface: Surface | null  // null = not set yet; managed manually via admin panel
  drawCloseAt: string
  startsAt: string
  endsAt: string
  status?: TournamentStatus
}

export interface MatchResult {
  externalMatchId: string
  tournamentExternalId: string
  round: Round
  winnerExternalId: string
  loserExternalId: string
  score: string
  playedAt: string
}

// Points per round per category (real ATP/WTA values)
export interface PointsTable {
  [category: string]: {
    [round: string]: number
  }
}
