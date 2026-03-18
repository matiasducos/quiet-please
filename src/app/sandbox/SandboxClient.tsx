'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import BracketPredictor from '@/app/tournaments/[id]/predict/BracketPredictor'

// ── Types ──────────────────────────────────────────────────────────────────
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

type Phase = 'idle' | 'predicting' | 'results'

interface SimRun {
  label: string
  total: number
  correct: number
  totalMatches: number
}

// ── Points table (inlined — same values as lib/tennis/points.ts) ───────────
const SIM_POINTS: Record<string, Partial<Record<string, number>>> = {
  grand_slam:   { R128: 10, R64: 45, R32: 90,  R16: 180, QF: 360, SF: 720 },
  masters_1000: { R128: 10, R64: 25, R32: 45,  R16: 90,  QF: 180, SF: 360 },
  '500':        {           R32: 20, R16: 30,  QF: 60,   SF: 90            },
  '250':        {           R32: 6,  R16: 13,  QF: 29,   SF: 45            },
}
const SIM_WINNER: Record<string, number> = {
  grand_slam: 2000, masters_1000: 1000, '500': 500, '250': 250,
}

function getSimPoints(category: string, round: string): number {
  // 'F' winner gets tournament winner points (same logic as award-points cron)
  if (round === 'F') return SIM_WINNER[category] ?? 0
  return SIM_POINTS[category]?.[round] ?? 0
}

function maxPoints(category: string, draw: Draw): number {
  let total = 0
  for (const m of draw.matches) total += getSimPoints(category, m.round)
  return total
}

// ── Feed map (same algorithm as BracketPredictor.tsx) ─────────────────────
const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']

function buildFeedMap(matches: DrawMatch[]) {
  const byRound: Record<string, DrawMatch[]> = {}
  for (const m of matches) {
    if (!byRound[m.round]) byRound[m.round] = []
    byRound[m.round].push(m)
  }
  const feedMap: Record<string, { nextMatchId: string; slot: 'player1' | 'player2' }> = {}
  const rounds = ROUND_ORDER.filter(r => byRound[r])
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    const cur = byRound[rounds[ri]]
    const nxt = byRound[rounds[ri + 1]]
    if (!nxt?.length) continue
    for (let i = 0; i < cur.length; i++) {
      const slot = i % 2 === 0 ? 'player1' : 'player2'
      if (nxt[Math.floor(i / 2)]) {
        feedMap[cur[i].matchId] = { nextMatchId: nxt[Math.floor(i / 2)].matchId, slot }
      }
    }
  }
  return feedMap
}

// ── Simulation engine ──────────────────────────────────────────────────────
function simulateTournament(draw: Draw): Record<string, string> {
  const results: Record<string, string> = {}
  const feedMap = buildFeedMap(draw.matches)
  const byRound: Record<string, DrawMatch[]> = {}
  for (const m of draw.matches) {
    if (!byRound[m.round]) byRound[m.round] = []
    byRound[m.round].push(m)
  }

  // Track actual players in each match slot (starts from draw, then propagates)
  const eff: Record<string, { p1: Player | null; p2: Player | null }> = {}
  for (const m of draw.matches) eff[m.matchId] = { p1: m.player1, p2: m.player2 }

  for (const round of ROUND_ORDER.filter(r => draw.rounds.includes(r))) {
    for (const m of byRound[round] ?? []) {
      const { p1, p2 } = eff[m.matchId]
      const candidates = [p1, p2].filter((p): p is Player => p !== null)
      if (candidates.length === 0) continue
      // Pure 50/50 — good enough for QA purposes
      const winner = candidates[Math.floor(Math.random() * candidates.length)]
      results[m.matchId] = winner.externalId
      const feed = feedMap[m.matchId]
      if (feed) {
        if (!eff[feed.nextMatchId]) eff[feed.nextMatchId] = { p1: null, p2: null }
        eff[feed.nextMatchId][feed.slot === 'player1' ? 'p1' : 'p2'] = winner
      }
    }
  }
  return results
}

function scoreSimulation(
  picks: Record<string, string>,
  results: Record<string, string>,
  draw: Draw,
  category: string,
): { total: number; byMatch: Record<string, number>; correctCount: number } {
  let total = 0
  let correctCount = 0
  const byMatch: Record<string, number> = {}
  for (const m of draw.matches) {
    const picked = picks[m.matchId]
    const winner = results[m.matchId]
    if (!picked || !winner || picked !== winner) continue
    const pts = getSimPoints(category, m.round)
    if (pts > 0) { total += pts; byMatch[m.matchId] = pts; correctCount++ }
  }
  return { total, byMatch, correctCount }
}

// ── Player pool ────────────────────────────────────────────────────────────
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
  { name: "C. O'Connell",       country: 'AUS' },
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

function makePlayers(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => {
    const p = ATP_PLAYERS[i % ATP_PLAYERS.length]
    const isQ = i >= ATP_PLAYERS.length
    return {
      externalId: `p${i + 1}`,
      name: isQ ? `${p.name} (Q)` : p.name,
      country: p.country,
      seed: isQ ? undefined : (p as any).seed,
    }
  })
}

function generateDraw(extId: string, rounds: string[], players: Player[]): Draw {
  const firstRound = rounds[0]
  const matches: DrawMatch[] = []
  const firstRoundMatchCount = players.length / 2
  for (let i = 0; i < firstRoundMatchCount; i++) {
    matches.push({
      matchId: `${extId}-${firstRound}-${i}`,
      round: firstRound,
      player1: players[i * 2]     ?? null,
      player2: players[i * 2 + 1] ?? null,
    })
  }
  for (let ri = 1; ri < rounds.length; ri++) {
    const round = rounds[ri]
    const matchCount = Math.pow(2, rounds.length - 1 - ri)
    for (let i = 0; i < matchCount; i++) {
      matches.push({ matchId: `${extId}-${round}-${i}`, round, player1: null, player2: null })
    }
  }
  return { tournamentExternalId: extId, rounds, matches }
}

// ── Sandbox configurations ─────────────────────────────────────────────────
const SANDBOXES = [
  {
    key: 'atp250',
    label: 'ATP 250',
    category: '250' as const,
    tournament: { id: 'sandbox-250', name: 'Eastbourne International', tour: 'ATP' },
    draw: generateDraw('sb-250', ['R16', 'QF', 'SF', 'F'], makePlayers(16)),
  },
  {
    key: 'atp500',
    label: 'ATP 500',
    category: '500' as const,
    tournament: { id: 'sandbox-500', name: 'Dubai Duty Free Tennis Championships', tour: 'ATP' },
    draw: generateDraw('sb-500', ['R32', 'R16', 'QF', 'SF', 'F'], makePlayers(32)),
  },
  {
    key: 'm1000',
    label: 'Masters 1000',
    category: 'masters_1000' as const,
    tournament: { id: 'sandbox-1000', name: 'BNP Paribas Open (Indian Wells)', tour: 'ATP' },
    draw: generateDraw('sb-1000', ['R64', 'R32', 'R16', 'QF', 'SF', 'F'], makePlayers(64)),
  },
  {
    key: 'gs',
    label: 'Grand Slam',
    category: 'grand_slam' as const,
    tournament: { id: 'sandbox-gs', name: 'Roland Garros', tour: 'ATP' },
    draw: generateDraw('sb-gs', ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'], makePlayers(128)),
  },
]

// ── Component ──────────────────────────────────────────────────────────────
export default function SandboxClient({
  userId,
  username,
  points = 0,
  nav,
}: {
  userId: string | null
  username: string | null
  points?: number
  /** Server-rendered <Nav> passed from the server page to avoid importing
   *  server-only modules (next/headers) into this client component. */
  nav?: ReactNode
}) {
  const [activeTab, setActiveTab]     = useState('atp250')
  const [phase, setPhase]             = useState<Phase>('idle')
  const [runKey, setRunKey]           = useState(0)
  const [simResults, setSimResults]   = useState<Record<string, string>>({})
  const [matchPts, setMatchPts]       = useState<Record<string, number>>({})
  const [totalPts, setTotalPts]       = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  const [lockedPicks, setLockedPicks] = useState<Record<string, string>>({})
  const [pastRuns, setPastRuns]       = useState<SimRun[]>([])
  const [awardStatus, setAwardStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [sessionTotal, setSessionTotal] = useState(0)

  const current = SANDBOXES.find(s => s.key === activeTab)!

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleStart = () => {
    setPhase('predicting')
    setSimResults({})
    setMatchPts({})
    setTotalPts(0)
    setCorrectCount(0)
    setLockedPicks({})
    setAwardStatus('idle')
    setRunKey(k => k + 1)
  }

  const handleTabChange = (key: string) => {
    setActiveTab(key)
    // Reset to idle so next Start picks the right draw
    setPhase('idle')
  }

  const handleSimulateSubmit = (picks: Record<string, string>) => {
    if (Object.keys(picks).length === 0) return

    const results = simulateTournament(current.draw)
    const { total, byMatch, correctCount: cc } = scoreSimulation(picks, results, current.draw, current.category)

    setLockedPicks(picks)
    setSimResults(results)
    setMatchPts(byMatch)
    setTotalPts(total)
    setCorrectCount(cc)
    setPhase('results')

    setPastRuns(prev => [
      { label: current.label, total, correct: cc, totalMatches: current.draw.matches.length },
      ...prev.slice(0, 9),
    ])
    setSessionTotal(t => t + total)

    // Persist to leaderboard if logged in
    if (userId && total > 0) {
      setAwardStatus('saving')
      fetch('/api/sandbox/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: total }),
      })
        .then(r => r.ok ? setAwardStatus('saved') : setAwardStatus('error'))
        .catch(() => setAwardStatus('error'))
    }
  }

  const handleRunAnother = () => {
    setPhase('predicting')
    setSimResults({})
    setMatchPts({})
    setTotalPts(0)
    setCorrectCount(0)
    setLockedPicks({})
    setAwardStatus('idle')
    setRunKey(k => k + 1)
  }

  const handleBackToIdle = () => setPhase('idle')

  // ── Idle phase UI ──────────────────────────────────────────────────────
  if (phase === 'idle') {
    const maxPts = maxPoints(current.category, current.draw)

    return (
      <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        {nav}

        <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">

          {/* Page header */}
          <div className="mb-8">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                Sandbox
              </h1>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
                letterSpacing: '0.1em',
                background: '#1e293b',
                color: '#94a3b8',
                padding: '3px 8px',
                borderRadius: '2px',
                verticalAlign: 'middle',
              }}>
                QA
              </span>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
              Simulate a tournament, make your picks, and see how the points engine scores them.
              Results add to your leaderboard total.
            </p>
          </div>

          {/* Tournament format selector */}
          <div className="mb-6">
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '10px' }}>
              TOURNAMENT FORMAT
            </p>
            <div className="flex flex-wrap gap-2">
              {SANDBOXES.map(s => {
                const isActive = activeTab === s.key
                return (
                  <button
                    key={s.key}
                    onClick={() => handleTabChange(s.key)}
                    style={{
                      padding: '8px 18px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8rem',
                      letterSpacing: '0.04em',
                      background: isActive ? 'var(--ink)' : 'white',
                      color: isActive ? 'white' : 'var(--muted)',
                      border: `1px solid ${isActive ? 'var(--ink)' : 'var(--chalk-dim)'}`,
                      borderRadius: '2px',
                      cursor: 'pointer',
                      transition: 'all 0.12s ease',
                    }}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Selected tournament info card */}
          <div
            className="rounded-sm border p-5 mb-8"
            style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '4px' }}>
                  {current.label.toUpperCase()}
                </p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                  {current.tournament.name}
                </p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', marginTop: '6px' }}>
                  {current.draw.matches.length} matches · {current.draw.rounds.join(' → ')}
                </p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: '2px' }}>
                  MAX IF PERFECT
                </p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', color: 'var(--court)', letterSpacing: '-0.02em' }}>
                  {maxPts.toLocaleString()} pts
                </p>
              </div>
            </div>
          </div>

          {/* Start button */}
          <button
            onClick={handleStart}
            style={{
              display: 'block',
              width: '100%',
              padding: '16px',
              fontFamily: 'var(--font-display)',
              fontSize: '1.1rem',
              letterSpacing: '-0.01em',
              background: 'var(--court)',
              color: 'white',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              marginBottom: '40px',
              transition: 'opacity 0.12s ease',
            }}
          >
            ▶ Start simulation
          </button>

          {/* Past runs */}
          {pastRuns.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)' }}>
                  THIS SESSION — {pastRuns.length} run{pastRuns.length !== 1 ? 's' : ''}
                </p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                  Total added: <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{sessionTotal.toLocaleString()} pts</span>
                </p>
              </div>

              <div className="rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--chalk-dim)', background: '#fafaf8' }}>
                      {['#', 'Format', 'Points', 'Correct picks'].map(h => (
                        <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em', color: 'var(--muted)', fontWeight: 500 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pastRuns.map((run, i) => (
                      <tr key={i} style={{ borderBottom: i < pastRuns.length - 1 ? '1px solid var(--chalk-dim)' : 'none', background: 'white' }}>
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                          {pastRuns.length - i}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--ink)' }}>
                          {run.label}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--font-display)', fontSize: '1rem', color: run.total > 0 ? 'var(--court)' : 'var(--muted)' }}>
                          +{run.total.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                          {run.correct}/{run.totalMatches}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!userId && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '10px', textAlign: 'center' }}>
                  <Link href="/login" style={{ color: 'var(--court)' }}>Sign in</Link>
                  {' '}to add simulation points to your leaderboard ranking.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Predicting + Results phases — BracketPredictor takes the screen ────
  const isResults = phase === 'results'

  const customBanner = isResults ? (
    // Results banner: green, shows points + run again button
    <div style={{ borderBottom: '1px solid #bbf7d0', background: '#f0fdf4' }}>
      <div className="flex items-center justify-between px-4 md:px-6 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: '#166534', fontWeight: 600, flexShrink: 0 }}>
            SIMULATION RESULT
          </span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: '#166534', letterSpacing: '-0.01em' }}>
            +{totalPts.toLocaleString()} pts
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#166534' }}>
            ({correctCount}/{current.draw.matches.length} correct)
          </span>
          {awardStatus === 'saving' && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#4ade80' }}>· Saving to leaderboard…</span>
          )}
          {awardStatus === 'saved' && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#166534' }}>· Added to leaderboard ✓</span>
          )}
          {awardStatus === 'error' && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#991b1b' }}>· Could not save (sign in?)</span>
          )}
          {!userId && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#4b7c5b' }}>
              · <Link href="/login" style={{ color: 'var(--court)' }}>Sign in</Link> to add to leaderboard
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button
            onClick={handleBackToIdle}
            style={{
              padding: '6px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--muted)',
              background: 'white',
              border: '1px solid var(--chalk-dim)',
              borderRadius: '2px',
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
          <button
            onClick={handleRunAnother}
            style={{
              padding: '6px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'white',
              background: 'var(--court)',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Run another →
          </button>
        </div>
      </div>
      {/* Point breakdown by round */}
      {Object.keys(matchPts).length > 0 && (() => {
        const byRound: Record<string, { count: number; pts: number }> = {}
        for (const m of current.draw.matches) {
          const pts = matchPts[m.matchId]
          if (!pts) continue
          byRound[m.round] = byRound[m.round] ?? { count: 0, pts: 0 }
          byRound[m.round].count++
          byRound[m.round].pts += pts
        }
        const entries = Object.entries(byRound)
        if (entries.length === 0) return null
        return (
          <div className="px-4 md:px-6 pb-2 flex flex-wrap gap-x-4 gap-y-1">
            {entries.map(([round, { count, pts }]) => (
              <span key={round} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: '#4b7c5b' }}>
                {round}: {count} × {getSimPoints(current.category, round)} = <strong>+{pts}</strong>
              </span>
            ))}
          </div>
        )
      })()}
    </div>
  ) : (
    // Predicting banner: dark slate, SIMULATION MODE label
    <div style={{ borderBottom: '1px solid #334155', background: '#1e293b' }}>
      <div className="flex items-center justify-between px-4 md:px-6 py-2">
        <div className="flex items-center gap-3">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.1em', color: '#94a3b8', fontWeight: 600 }}>
            SIMULATION MODE
          </span>
          <span className="hidden md:inline" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#64748b' }}>
            {current.label} · {current.tournament.name}
          </span>
          <span className="hidden md:inline" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#64748b' }}>
            · Fill your bracket, then Submit &amp; lock to see results
          </span>
        </div>
        <button
          onClick={handleBackToIdle}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: '#64748b',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 6px',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <BracketPredictor
      key={`${current.key}-${runKey}${isResults ? '-results' : ''}`}
      tournament={current.tournament}
      draw={current.draw as any}
      existingPicks={isResults ? lockedPicks : {}}
      predictionId={null}
      username={username ?? 'sandbox'}
      returnUrl="/sandbox"
      isPractice={false}
      matchResults={isResults ? simResults : {}}
      matchPoints={isResults ? matchPts : undefined}
      readOnly={isResults}
      onSimulateSubmit={!isResults ? handleSimulateSubmit : undefined}
      customBanner={customBanner}
    />
  )
}
