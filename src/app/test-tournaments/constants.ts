export const TEST_EXTERNAL_ID = 'test-indian-wells-2026'

export const TEST_DRAW = {
  tournamentExternalId: TEST_EXTERNAL_ID,
  rounds: ['QF', 'SF', 'F'],
  matches: [
    // Quarterfinals — seeded bracket: 1v8, 4v5, 3v6, 2v7
    {
      matchId: 'test-iw-qf1', round: 'QF',
      player1: { externalId: 'test-sinner',   name: 'Jannik Sinner',    country: 'ITA', seed: 1 },
      player2: { externalId: 'test-hurkacz',  name: 'Hubert Hurkacz',   country: 'POL', seed: 8 },
    },
    {
      matchId: 'test-iw-qf2', round: 'QF',
      player1: { externalId: 'test-medvedev', name: 'Daniil Medvedev',  country: 'RUS', seed: 4 },
      player2: { externalId: 'test-zverev',   name: 'Alexander Zverev', country: 'GER', seed: 5 },
    },
    {
      matchId: 'test-iw-qf3', round: 'QF',
      player1: { externalId: 'test-djokovic', name: 'Novak Djokovic',   country: 'SRB', seed: 3 },
      player2: { externalId: 'test-fritz',    name: 'Taylor Fritz',     country: 'USA', seed: 6 },
    },
    {
      matchId: 'test-iw-qf4', round: 'QF',
      player1: { externalId: 'test-alcaraz',  name: 'Carlos Alcaraz',   country: 'ESP', seed: 2 },
      player2: { externalId: 'test-rublev',   name: 'Andrey Rublev',    country: 'RUS', seed: 7 },
    },
    // Semifinals — players flow from picks
    { matchId: 'test-iw-sf1', round: 'SF', player1: null, player2: null },
    { matchId: 'test-iw-sf2', round: 'SF', player1: null, player2: null },
    // Final
    { matchId: 'test-iw-f', round: 'F', player1: null, player2: null },
  ],
}

// Pre-determined results — revealed when user clicks "Simulate"
// Fritz upsets Djokovic; Alcaraz wins the title over Sinner
export const TEST_RESULTS = [
  { matchId: 'test-iw-qf1', round: 'QF', winner: 'test-sinner',   loser: 'test-hurkacz',  score: '6-3, 6-4' },
  { matchId: 'test-iw-qf2', round: 'QF', winner: 'test-medvedev', loser: 'test-zverev',   score: '7-6(4), 6-3' },
  { matchId: 'test-iw-qf3', round: 'QF', winner: 'test-fritz',    loser: 'test-djokovic', score: '6-4, 6-2' },
  { matchId: 'test-iw-qf4', round: 'QF', winner: 'test-alcaraz',  loser: 'test-rublev',   score: '6-2, 6-1' },
  { matchId: 'test-iw-sf1', round: 'SF', winner: 'test-sinner',   loser: 'test-medvedev', score: '6-3, 6-4' },
  { matchId: 'test-iw-sf2', round: 'SF', winner: 'test-alcaraz',  loser: 'test-fritz',    score: '6-1, 6-3' },
  { matchId: 'test-iw-f',   round: 'F',  winner: 'test-alcaraz',  loser: 'test-sinner',   score: '6-3, 6-7(5), 6-4' },
] as const

// Human-readable player names for the results display
export const PLAYER_NAMES: Record<string, string> = {
  'test-sinner':   'Sinner',
  'test-hurkacz':  'Hurkacz',
  'test-medvedev': 'Medvedev',
  'test-zverev':   'Zverev',
  'test-djokovic': 'Djokovic',
  'test-fritz':    'Fritz',
  'test-alcaraz':  'Alcaraz',
  'test-rublev':   'Rublev',
}
