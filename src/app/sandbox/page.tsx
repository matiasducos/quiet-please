'use client'

import { useState } from 'react'
import BracketPredictor from '@/app/tournaments/[id]/predict/BracketPredictor'

// ── Player pool (64 ATP players) ──────────────────────────────────────────
// Seeded positions 1-8 get official seeds; the rest are unseeded.
const ATP_PLAYERS = [
  { name: 'J. Sinner',          country: 'ITA', seed: 1 },
  { name: 'C. Alcaraz',         country: 'ESP', seed: 2 },
  { name: 'N. Djokovic',        country: 'SRB', seed: 3 },
  { name: 'A. Zverev',          country: 'GER', seed: 4 },
  { name: 'D. Medvedev',        country: 'RUS', seed: 5 },
  { name: 'C. Ruud',            country: 'NOR', seed: 6 },
  { name: 'H. Hurkacz',         country: 'POL', seed: 7 },
  { name: 'A. de Minaur',       country: 'AUS', seed: 8 },
  { name: 'S. Tsitsipas',       country: 'GRE' },
  { name: 'T. Fritz',           country: 'USA' },
  { name: 'G. Dimitrov',        country: 'BUL' },
  { name: 'A. Rublev',          country: 'RUS' },
  { name: 'H. Rune',            country: 'DEN' },
  { name: 'F. Auger-Aliassime', country: 'CAN' },
  { name: 'B. Shelton',         country: 'USA' },
  { name: 'T. Paul',            country: 'USA' },
  { name: 'L. Musetti',         country: 'ITA' },
  { name: 'F. Tiafoe',          country: 'USA' },
  { name: 'U. Humbert',         country: 'FRA' },
  { name: 'J. Struff',          country: 'GER' },
  { name: 'K. Khachanov',       country: 'RUS' },
  { name: 'T. Machač',          country: 'CZE' },
  { name: 'J. Mensík',          country: 'CZE' },
  { name: 'S. Wawrinka',        country: 'SUI' },
  { name: 'M. Berrettini',      country: 'ITA' },
  { name: 'N. Norrie',          country: 'GBR' },
  { name: 'S. Baez',            country: 'ARG' },
  { name: 'F. Cerundolo',       country: 'ARG' },
  { name: 'F. Cobolli',         country: 'ITA' },
  { name: 'A. Navone',          country: 'ARG' },
  { name: 'B. Fearnley',        country: 'GBR' },
  { name: 'M. Arnaldi',         country: 'ITA' },
  { name: 'R. Safiullin',       country: 'RUS' },
  { name: 'L. Sonego',          country: 'ITA' },
  { name: 'J. Draper',          country: 'GBR' },
  { name: 'G. Monfils',         country: 'FRA' },
  { name: 'F. Marozsan',        country: 'HUN' },
  { name: 'D. Goffin',          country: 'BEL' },
  { name: 'A. Michelsen',       country: 'USA' },
  { name: 'M. Moraing',         country: 'GER' },
  { name: 'T. Griekspoor',      country: 'NED' },
  { name: 'G. Barrere',         country: 'FRA' },
  { name: 'C. O\'Connell',      country: 'AUS' },
  { name: 'Y. Hanfmann',        country: 'GER' },
  { name: 'A. Muller',          country: 'FRA' },
  { name: 'M. Kecmanovic',      country: 'SRB' },
  { name: 'D. Altmaier',        country: 'GER' },
  { name: 'T. Etcheverry',      country: 'ARG' },
  { name: 'M. Giron',           country: 'USA' },
  { name: 'B. Paire',           country: 'FRA' },
  { name: 'C. Eubanks',         country: 'USA' },
  { name: 'B. Nakashima',       country: 'USA' },
  { name: 'R. Albot',           country: 'MDA' },
  { name: 'E. Ruusuvuori',      country: 'FIN' },
  { name: 'A. Karatsev',        country: 'RUS' },
  { name: 'V. Kopriva',         country: 'CZE' },
  { name: 'A. Cazaux',          country: 'FRA' },
  { name: 'H. Gaston',          country: 'FRA' },
  { name: 'S. Kwon',            country: 'KOR' },
  { name: 'E. Ymer',            country: 'SWE' },
  { name: 'M. Purcell',         country: 'AUS' },
  { name: 'Z. Zhang',           country: 'CHN' },
  { name: 'J. Shang',           country: 'CHN' },
  { name: 'C. Garin',           country: 'CHI' },
]

// ── Types (match BracketPredictor's internal types) ────────────────────────
interface Player {
  externalId: string
  name: string
  country: string
  seed?: number
}

interface DrawMatch {
  matchId: string
  round: string
  player1: Player | null
  player2: Player | null
}

interface Draw {
  tournamentExternalId: string
  rounds: string[]
  matches: DrawMatch[]
}

/**
 * Generate a full bracket draw from a list of rounds and a player pool.
 *
 * Only the first round gets actual players populated — later rounds use null
 * because BracketPredictor's getEffectivePlayer() derives them from picks at
 * render time. This mirrors how real tournament data comes back from the API.
 *
 * Seedings are placed in traditional bracket positions:
 *  [1] vs bye, ... [8] vs bye at opposite ends of the bracket.
 */
function generateDraw(extId: string, rounds: string[], players: Player[]): Draw {
  const firstRound = rounds[0]
  const firstRoundMatchCount = players.length / 2
  const matches: DrawMatch[] = []

  // First round: pair players consecutively
  for (let i = 0; i < firstRoundMatchCount; i++) {
    matches.push({
      matchId: `${extId}-${firstRound}-${i}`,
      round: firstRound,
      player1: players[i * 2]  ?? null,
      player2: players[i * 2 + 1] ?? null,
    })
  }

  // Subsequent rounds: null players (derived from picks by getEffectivePlayer)
  for (let ri = 1; ri < rounds.length; ri++) {
    const round = rounds[ri]
    const matchCount = Math.pow(2, rounds.length - 1 - ri)
    for (let i = 0; i < matchCount; i++) {
      matches.push({
        matchId: `${extId}-${round}-${i}`,
        round,
        player1: null,
        player2: null,
      })
    }
  }

  return { tournamentExternalId: extId, rounds, matches }
}

// Build a Player object from the pool entry (with stable externalId).
// For draws larger than the pool, cycles back through with a "(Q)" qualifier suffix.
function players(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => {
    const p = ATP_PLAYERS[i % ATP_PLAYERS.length]
    const isQualifier = i >= ATP_PLAYERS.length
    return {
      externalId: `p${i + 1}`,
      name: isQualifier ? `${p.name} (Q)` : p.name,
      country: p.country,
      seed: isQualifier ? undefined : p.seed,
    }
  })
}

// ── Sandbox configurations ─────────────────────────────────────────────────
const SANDBOXES = [
  {
    key: 'atp250',
    label: 'ATP 250',
    tournament: { id: 'sandbox-250', name: 'Eastbourne International', tour: 'ATP' },
    draw: generateDraw('sb-250', ['R16', 'QF', 'SF', 'F'], players(16)),
  },
  {
    key: 'atp500',
    label: 'ATP 500',
    tournament: { id: 'sandbox-500', name: 'Dubai Duty Free Tennis Championships', tour: 'ATP' },
    draw: generateDraw('sb-500', ['R32', 'R16', 'QF', 'SF', 'F'], players(32)),
  },
  {
    key: 'm1000',
    label: 'Masters 1000',
    tournament: { id: 'sandbox-1000', name: 'BNP Paribas Open (Indian Wells)', tour: 'ATP' },
    draw: generateDraw('sb-1000', ['R64', 'R32', 'R16', 'QF', 'SF', 'F'], players(64)),
  },
  {
    key: 'gs',
    label: 'Grand Slam',
    tournament: { id: 'sandbox-gs', name: 'Roland Garros', tour: 'ATP' },
    draw: generateDraw('sb-gs', ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'], players(128)),
  },
]

export default function SandboxPage() {
  const [activeTab, setActiveTab] = useState<string>('atp250')

  const current = SANDBOXES.find(s => s.key === activeTab)!

  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>

      {/* Sandbox banner */}
      <div
        className="px-4 py-2 text-center"
        style={{
          background: '#1e293b',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          letterSpacing: '0.08em',
          color: '#94a3b8',
        }}
      >
        SANDBOX — bracket UI preview only · save/submit are no-ops
      </div>

      {/* Tournament type tabs */}
      <div
        className="flex border-b bg-white px-4 gap-1"
        style={{ borderColor: 'var(--chalk-dim)' }}
      >
        {SANDBOXES.map(s => (
          <button
            key={s.key}
            onClick={() => setActiveTab(s.key)}
            style={{
              padding: '0.75rem 1rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              letterSpacing: '0.04em',
              color: activeTab === s.key ? 'var(--ink)' : 'var(--muted)',
              borderBottom: activeTab === s.key ? '2px solid var(--court)' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* BracketPredictor — key forces full remount when tab changes */}
      <BracketPredictor
        key={current.key}
        tournament={current.tournament}
        draw={current.draw as any}
        existingPicks={{}}
        predictionId={null}
        username="sandbox"
        returnUrl="/sandbox"
        isPractice={false}
        matchResults={{}}
      />
    </div>
  )
}
