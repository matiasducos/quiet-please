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
  const [completeStatus, setCompleteStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' })

  // Tracks which rounds are expanded (all collapsed by default)
  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(new Set())

  // Tracks which matches are in "edit" mode (re-selecting winner)
  const [editingMatches, setEditingMatches] = useState<Set<string>>(new Set())

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

  // Progress counters
  const totalMatches = bracketData.matches.length
  const totalResultsEntered = results.length

  function getRoundProgress(round: string): { entered: number; total: number } {
    const roundMatches = bracketData.matches.filter(m => m.round === round)
    const entered = roundMatches.filter(m => resultMap.has(m.matchId)).length
    return { entered, total: roundMatches.length }
  }

  function toggleRound(round: string) {
    setExpandedRounds(prev => {
      const next = new Set(prev)
      if (next.has(round)) next.delete(round)
      else next.add(round)
      return next
    })
  }

  function toggleEditMatch(matchId: string) {
    setEditingMatches(prev => {
      const next = new Set(prev)
      if (next.has(matchId)) next.delete(matchId)
      else next.add(matchId)
      return next
    })
  }

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
      )
      if (ok) {
        setResults(prev => {
          const filtered = prev.filter(r => r.external_match_id !== match.matchId)
          return [...filtered, {
            external_match_id: match.matchId,
            round: match.round,
            winner_external_id: winnerId,
            loser_external_id: loserId,
            score: null,
          }]
        })
        // Exit edit mode for this match after saving
        setEditingMatches(prev => {
          const next = new Set(prev)
          next.delete(match.matchId)
          return next
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
      {/* Sticky admin nav */}
      <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Admin
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Results
          </span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {tournamentName}
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Click on a player to select them as the winner.
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
            Status: {tournamentStatus}
          </p>
        </div>

        {bracketData.rounds.map(round => {
          const roundMatches = bracketData.matches.filter(m => m.round === round)
          const { entered, total } = getRoundProgress(round)
          const isExpanded = expandedRounds.has(round)
          const isComplete = entered === total

          return (
            <div key={round} style={{ marginBottom: '10px' }}>
              {/* Round header — styled like TournamentMonthGroup */}
              <button
                type="button"
                onClick={() => toggleRound(round)}
                className="w-full flex items-center justify-between"
                style={{
                  background: 'white',
                  border: '1px solid var(--chalk-dim)',
                  borderRadius: isExpanded ? '4px 4px 0 0' : '4px',
                  padding: '14px 18px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.07)',
                  transition: 'box-shadow 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0, lineHeight: 1 }}>
                    {ROUND_LABELS[round] ?? round}
                  </h2>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.65rem',
                      color: isComplete ? '#166534' : 'var(--muted)',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {entered}/{total}
                  </span>
                </div>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    background: isComplete ? '#dcfce7' : 'var(--chalk)',
                    color: isExpanded ? 'var(--court)' : 'var(--ink)',
                    fontSize: '1rem',
                    flexShrink: 0,
                    transition: 'transform 0.2s ease, color 0.15s ease',
                    transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                  }}
                >
                  ▾
                </span>
              </button>

              {/* Match list — only shown when expanded */}
              {isExpanded && (
                <div
                  className="flex flex-col gap-2"
                  style={{
                    border: '1px solid var(--chalk-dim)',
                    borderTop: 'none',
                    borderRadius: '0 0 4px 4px',
                    padding: '14px',
                    background: 'var(--chalk)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                  }}
                >
                  {roundMatches.map(match => {
                    const result = resultMap.get(match.matchId)
                    const isEditing = editingMatches.has(match.matchId)
                    const { player1, player2 } = resolveMatchPlayers(match)
                    const isBye = result?.loser_external_id === 'bye'
                    const isSaving = savingMatch === match.matchId
                    // Playable if both players known and either no result or in edit mode
                    const playable = player1 !== null && player2 !== null && (!result || isEditing)

                    return (
                      <div
                        key={match.matchId}
                        className="bg-white rounded-sm border p-3"
                        style={{
                          borderColor: result && !isEditing ? '#bbf7d0' : 'var(--chalk-dim)',
                          opacity: isBye ? 0.5 : 1,
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {/* Player 1 */}
                          <button
                            type="button"
                            disabled={!playable || isSaving}
                            onClick={() => player1 && player2 && handleSelectWinner(match, player1.externalId, player2.externalId)}
                            className="flex-1 py-1.5 px-2 rounded-sm text-left transition-colors"
                            style={{
                              fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                              background: result?.winner_external_id === player1?.externalId && !isEditing ? '#dcfce7' : (playable ? 'var(--chalk)' : 'transparent'),
                              color: player1 ? 'var(--ink)' : 'var(--muted)',
                              cursor: playable ? 'pointer' : 'default',
                              border: result?.winner_external_id === player1?.externalId && !isEditing ? '1px solid #86efac' : '1px solid transparent',
                            }}
                          >
                            {player1 ? `${player1.name}${player1.country ? ` (${player1.country})` : ''}` : 'TBD'}
                            {result?.winner_external_id === player1?.externalId && !isEditing && ' ✓'}
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
                              background: result?.winner_external_id === player2?.externalId && !isEditing ? '#dcfce7' : (playable ? 'var(--chalk)' : 'transparent'),
                              color: player2 ? 'var(--ink)' : 'var(--muted)',
                              cursor: playable ? 'pointer' : 'default',
                              border: result?.winner_external_id === player2?.externalId && !isEditing ? '1px solid #86efac' : '1px solid transparent',
                            }}
                          >
                            {player2 ? `${player2.name}${player2.country ? ` (${player2.country})` : ''}` : 'TBD'}
                            {result?.winner_external_id === player2?.externalId && !isEditing && ' ✓'}
                          </button>

                          {/* BYE label */}
                          {isBye && (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                              BYE
                            </span>
                          )}

                          {/* Saving indicator */}
                          {isSaving && (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                              Saving...
                            </span>
                          )}

                          {/* Edit button — shown for matches with results (non-bye) that are not currently being edited */}
                          {result && !isBye && !isEditing && (
                            <button
                              type="button"
                              onClick={() => toggleEditMatch(match.matchId)}
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.6rem',
                                color: 'var(--muted)',
                                background: 'none',
                                border: '1px solid var(--chalk-dim)',
                                borderRadius: '2px',
                                padding: '2px 6px',
                                cursor: 'pointer',
                              }}
                            >
                              Edit
                            </button>
                          )}

                          {/* Cancel edit button */}
                          {isEditing && (
                            <button
                              type="button"
                              onClick={() => toggleEditMatch(match.matchId)}
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.6rem',
                                color: '#991b1b',
                                background: 'none',
                                border: '1px solid #fecaca',
                                borderRadius: '2px',
                                padding: '2px 6px',
                                cursor: 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Mark as completed — with global progress */}
        {tournamentStatus !== 'completed' && (
          <div className="mt-8">
            <div className="flex items-center gap-4">
              <button
                onClick={handleMarkComplete}
                disabled={completeStatus.type === 'loading'}
                className="px-6 py-2 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: '#111', color: 'white' }}
              >
                {completeStatus.type === 'loading' ? 'Completing...' : 'Mark Tournament as Completed'}
              </button>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  color: totalResultsEntered === totalMatches ? '#166534' : 'var(--muted)',
                  background: totalResultsEntered === totalMatches ? '#dcfce7' : 'var(--chalk)',
                  padding: '4px 10px',
                  borderRadius: '9999px',
                }}
              >
                {totalResultsEntered}/{totalMatches} results
              </span>
              {completeStatus.message && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: completeStatus.type === 'error' ? '#991b1b' : '#166534' }}>
                  {completeStatus.message}
                </p>
              )}
            </div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '8px' }}>
              Remember to run Award Points from the admin panel before marking as completed.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
