'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { saveMatchResult, setTournamentStatus } from '../../../actions'

interface Player {
  externalId: string
  name: string
  country: string
}

interface DrawMatch {
  matchId: string
  round: string
  player1: Player | null
  player2: Player | null
}

interface MatchResult {
  external_match_id: string
  round: string
  winner_external_id: string
  loser_external_id: string
  score: string | null
}

interface ResultsEntryProps {
  tournamentId: string
  tournamentName: string
  tournamentStatus: string
  bracketData: {
    rounds: string[]
    matches: DrawMatch[]
  }
  matchResults: MatchResult[]
}

const ROUND_LABELS: Record<string, string> = {
  R128: 'Round of 128',
  R64: 'Round of 64',
  R32: 'Round of 32',
  R16: 'Round of 16',
  QF: 'Quarterfinals',
  SF: 'Semifinals',
  F: 'Final',
}

export default function ResultsEntry({
  tournamentId,
  tournamentName,
  tournamentStatus,
  bracketData,
  matchResults: initialResults,
}: ResultsEntryProps) {
  const [results, setResults] = useState<MatchResult[]>(initialResults)
  const [savingMatch, setSavingMatch] = useState<string | null>(null)
  const [scores, setScores] = useState<Record<string, string>>({})
  const [completeStatus, setCompleteStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' })

  // Build a map of matchId → result
  const resultMap = useMemo(() => {
    const map = new Map<string, MatchResult>()
    for (const r of results) map.set(r.external_match_id, r)
    return map
  }, [results])

  // Build a map of player externalId → Player (from bracket data)
  const playerMap = useMemo(() => {
    const map = new Map<string, Player>()
    for (const m of bracketData.matches) {
      if (m.player1) map.set(m.player1.externalId, m.player1)
      if (m.player2) map.set(m.player2.externalId, m.player2)
    }
    return map
  }, [bracketData])

  // Resolve who the players are for a given match. For later rounds,
  // players come from the winners of earlier matches (via feed map).
  function resolveMatchPlayers(match: DrawMatch): { player1: Player | null; player2: Player | null } {
    if (match.player1 && match.player2) return { player1: match.player1, player2: match.player2 }

    // For later rounds, find the two feeder matches
    const roundIdx = bracketData.rounds.indexOf(match.round)
    if (roundIdx <= 0) return { player1: match.player1, player2: match.player2 }

    const prevRound = bracketData.rounds[roundIdx - 1]
    const prevMatches = bracketData.matches.filter(m => m.round === prevRound)
    const currentRoundMatches = bracketData.matches.filter(m => m.round === match.round)
    const matchIdx = currentRoundMatches.indexOf(match)

    const feeder1 = prevMatches[matchIdx * 2]
    const feeder2 = prevMatches[matchIdx * 2 + 1]

    let player1: Player | null = match.player1
    let player2: Player | null = match.player2

    if (!player1 && feeder1) {
      const r = resultMap.get(feeder1.matchId)
      if (r) player1 = playerMap.get(r.winner_external_id) ?? { externalId: r.winner_external_id, name: r.winner_external_id, country: '' }
    }
    if (!player2 && feeder2) {
      const r = resultMap.get(feeder2.matchId)
      if (r) player2 = playerMap.get(r.winner_external_id) ?? { externalId: r.winner_external_id, name: r.winner_external_id, country: '' }
    }

    return { player1, player2 }
  }

  async function handleSelectWinner(match: DrawMatch, winnerId: string, loserId: string) {
    setSavingMatch(match.matchId)
    try {
      const { ok, error } = await saveMatchResult(
        tournamentId,
        match.matchId,
        winnerId,
        loserId,
        scores[match.matchId] || undefined,
      )
      if (ok) {
        // Add to local results
        setResults(prev => {
          const filtered = prev.filter(r => r.external_match_id !== match.matchId)
          return [...filtered, {
            external_match_id: match.matchId,
            round: match.round,
            winner_external_id: winnerId,
            loser_external_id: loserId,
            score: scores[match.matchId] || null,
          }]
        })
      } else {
        alert(error ?? 'Failed to save result')
      }
    } finally {
      setSavingMatch(null)
    }
  }

  async function handleMarkComplete() {
    setCompleteStatus({ type: 'loading' })
    const { ok, error } = await setTournamentStatus(tournamentId, 'completed')
    if (ok) {
      setCompleteStatus({ type: 'success', message: 'Tournament marked as completed' })
    } else {
      setCompleteStatus({ type: 'error', message: error ?? 'Failed' })
    }
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Admin
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Results
          </span>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {tournamentName}
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Click on a player to select them as the winner.
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
            Status: {tournamentStatus} &middot; {results.length} results entered
          </p>
        </div>

        {bracketData.rounds.map(round => {
          const roundMatches = bracketData.matches.filter(m => m.round === round)
          return (
            <div key={round} className="mb-8">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--ink)' }}>
                {ROUND_LABELS[round] ?? round}
              </h2>
              <div className="flex flex-col gap-2">
                {roundMatches.map(match => {
                  const result = resultMap.get(match.matchId)
                  const { player1, player2 } = resolveMatchPlayers(match)
                  const isBye = result?.loser_external_id === 'bye'
                  const isSaving = savingMatch === match.matchId
                  const playable = player1 !== null && player2 !== null && !result

                  return (
                    <div key={match.matchId} className="bg-white rounded-sm border p-3" style={{ borderColor: result ? '#bbf7d0' : 'var(--chalk-dim)', opacity: isBye ? 0.5 : 1 }}>
                      <div className="flex items-center gap-2">
                        {/* Player 1 */}
                        <button
                          type="button"
                          disabled={!playable || isSaving}
                          onClick={() => player1 && player2 && handleSelectWinner(match, player1.externalId, player2.externalId)}
                          className="flex-1 py-1.5 px-2 rounded-sm text-left transition-colors"
                          style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                            background: result?.winner_external_id === player1?.externalId ? '#dcfce7' : (playable ? 'var(--chalk)' : 'transparent'),
                            color: player1 ? 'var(--ink)' : 'var(--muted)',
                            cursor: playable ? 'pointer' : 'default',
                            border: result?.winner_external_id === player1?.externalId ? '1px solid #86efac' : '1px solid transparent',
                          }}
                        >
                          {player1 ? `${player1.name}${player1.country ? ` (${player1.country})` : ''}` : 'TBD'}
                          {result?.winner_external_id === player1?.externalId && ' ✓'}
                        </button>

                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)' }}>vs</span>

                        {/* Player 2 */}
                        <button
                          type="button"
                          disabled={!playable || isSaving}
                          onClick={() => player1 && player2 && handleSelectWinner(match, player2.externalId, player1.externalId)}
                          className="flex-1 py-1.5 px-2 rounded-sm text-left transition-colors"
                          style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                            background: result?.winner_external_id === player2?.externalId ? '#dcfce7' : (playable ? 'var(--chalk)' : 'transparent'),
                            color: player2 ? 'var(--ink)' : 'var(--muted)',
                            cursor: playable ? 'pointer' : 'default',
                            border: result?.winner_external_id === player2?.externalId ? '1px solid #86efac' : '1px solid transparent',
                          }}
                        >
                          {player2 ? `${player2.name}${player2.country ? ` (${player2.country})` : ''}` : 'TBD'}
                          {result?.winner_external_id === player2?.externalId && ' ✓'}
                        </button>

                        {/* Score input */}
                        {playable && (
                          <input
                            value={scores[match.matchId] ?? ''}
                            onChange={e => setScores(prev => ({ ...prev, [match.matchId]: e.target.value }))}
                            placeholder="Score"
                            style={{
                              fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
                              padding: '4px 6px', border: '1px solid var(--chalk-dim)',
                              borderRadius: '2px', width: '80px',
                            }}
                          />
                        )}
                        {result?.score && result.score !== 'BYE' && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                            {result.score}
                          </span>
                        )}
                        {isBye && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                            BYE
                          </span>
                        )}
                        {isSaving && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                            Saving...
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Mark as completed */}
        {tournamentStatus !== 'completed' && (
          <div className="mt-4">
            <button
              onClick={handleMarkComplete}
              disabled={completeStatus.type === 'loading'}
              className="px-6 py-2 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: '#111', color: 'white' }}
            >
              {completeStatus.type === 'loading' ? 'Completing...' : 'Mark Tournament as Completed'}
            </button>
            {completeStatus.message && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: completeStatus.type === 'error' ? '#991b1b' : '#166534', marginTop: '8px' }}>
                {completeStatus.message}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
