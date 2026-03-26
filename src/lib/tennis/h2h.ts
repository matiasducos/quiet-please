import type { Surface } from './types'

// ── Types ────────────────────────────────────────────────────

export interface H2HMatchRecord {
  date: string          // ISO date, e.g. "2025-11-15"
  tournament: string    // e.g. "Australian Open"
  surface: Surface
  round: string         // e.g. "QF"
  winner: string        // player name
  score: string         // e.g. "6-4, 3-6, 7-5"
}

export interface H2HData {
  player1Name: string
  player2Name: string
  player1Wins: number
  player2Wins: number
  surfaceBreakdown: {
    surface: Surface
    player1Wins: number
    player2Wins: number
  }[]
  recentMatches: H2HMatchRecord[]  // Last 5, newest first
}

// ── Public API ───────────────────────────────────────────────

/**
 * Fetch H2H data for two players.
 * Currently returns mock data; swap body for DSG API call when ready.
 */
export async function getH2HData(
  _player1ExternalId: string,
  _player2ExternalId: string,
  player1Name: string,
  player2Name: string,
): Promise<H2HData> {
  // Simulate network delay
  await new Promise((r) => setTimeout(r, 400))
  return generateMockH2H(player1Name, player2Name)
}

// ── Mock data ────────────────────────────────────────────────

const MOCK_TOURNAMENTS = [
  'Australian Open', 'Roland Garros', 'Wimbledon', 'US Open',
  'Indian Wells', 'Miami Open', 'Monte Carlo', 'Madrid Open',
  'Rome Masters', 'Canadian Open', 'Cincinnati Masters', 'Shanghai Masters',
]

const TOURNAMENT_SURFACES: Record<string, Surface> = {
  'Australian Open': 'hard', 'Roland Garros': 'clay', 'Wimbledon': 'grass',
  'US Open': 'hard', 'Indian Wells': 'hard', 'Miami Open': 'hard',
  'Monte Carlo': 'clay', 'Madrid Open': 'clay', 'Rome Masters': 'clay',
  'Canadian Open': 'hard', 'Cincinnati Masters': 'hard', 'Shanghai Masters': 'hard',
}

const ROUNDS = ['R32', 'R16', 'QF', 'SF', 'F']

/** Deterministic seed from two player names so the same pair always gets the same mock data */
function hashPair(a: string, b: string): number {
  const s = [a, b].sort().join('|')
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function generateMockH2H(p1: string, p2: string): H2HData {
  const seed = hashPair(p1, p2)
  const seededRand = (i: number) => {
    const x = Math.sin(seed + i) * 10000
    return x - Math.floor(x)
  }

  // Generate 2-6 total meetings
  const totalMeetings = 2 + Math.floor(seededRand(0) * 5)

  const matches: H2HMatchRecord[] = []
  let p1Wins = 0
  let p2Wins = 0
  const surfaceWins: Record<Surface, [number, number]> = {
    hard: [0, 0], clay: [0, 0], grass: [0, 0],
  }

  for (let i = 0; i < totalMeetings; i++) {
    const tournamentIdx = Math.floor(seededRand(i + 10) * MOCK_TOURNAMENTS.length)
    const tournament = MOCK_TOURNAMENTS[tournamentIdx]
    const surface = TOURNAMENT_SURFACES[tournament]
    const round = ROUNDS[Math.floor(seededRand(i + 20) * ROUNDS.length)]
    const p1Won = seededRand(i + 30) > 0.45

    if (p1Won) { p1Wins++; surfaceWins[surface][0]++ }
    else { p2Wins++; surfaceWins[surface][1]++ }

    // Generate a realistic score
    const sets: string[] = []
    const numSets = seededRand(i + 40) > 0.6 ? 3 : 2
    for (let s = 0; s < numSets; s++) {
      const winnerGames = 6 + (seededRand(i + 50 + s) > 0.7 ? 1 : 0)
      const loserGames = Math.floor(seededRand(i + 60 + s) * 5)
      sets.push(`${winnerGames}-${loserGames}`)
    }

    // Generate a date within the last 3 years
    const yearOffset = Math.floor(seededRand(i + 70) * 3)
    const month = 1 + Math.floor(seededRand(i + 80) * 12)
    const day = 1 + Math.floor(seededRand(i + 90) * 28)
    const year = 2026 - yearOffset

    matches.push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      tournament,
      surface,
      round,
      winner: p1Won ? p1 : p2,
      score: sets.join(', '),
    })
  }

  // Sort newest first
  matches.sort((a, b) => b.date.localeCompare(a.date))

  return {
    player1Name: p1,
    player2Name: p2,
    player1Wins: p1Wins,
    player2Wins: p2Wins,
    surfaceBreakdown: (['hard', 'clay', 'grass'] as Surface[]).map((s) => ({
      surface: s,
      player1Wins: surfaceWins[s][0],
      player2Wins: surfaceWins[s][1],
    })),
    recentMatches: matches.slice(0, 5),
  }
}
