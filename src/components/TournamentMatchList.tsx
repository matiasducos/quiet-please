'use client'

import { useState, useMemo } from 'react'
import { nameToFlag } from '@/app/admin/countries'

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
  scheduledAt?: string
}

interface MatchResult {
  external_match_id: string
  round: string
  winner_external_id: string
  loser_external_id: string
  score: string | null
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

interface TournamentMatchListProps {
  rounds: string[]
  matches: DrawMatch[]
  matchResults: MatchResult[]
  mode: 'results' | 'upcoming'
}

export default function TournamentMatchList({ rounds, matches, matchResults, mode }: TournamentMatchListProps) {
  // Build result map for O(1) lookup
  const resultMap = useMemo(() => {
    const map = new Map<string, MatchResult>()
    for (const r of matchResults) map.set(r.external_match_id, r)
    return map
  }, [matchResults])

  // Build player map from bracket data
  const playerMap = useMemo(() => {
    const map = new Map<string, Player>()
    for (const m of matches) {
      if (m.player1) map.set(m.player1.externalId, m.player1)
      if (m.player2) map.set(m.player2.externalId, m.player2)
    }
    return map
  }, [matches])

  // Resolve players for later-round matches from feeder results
  function resolveMatchPlayers(match: DrawMatch): { player1: Player | null; player2: Player | null } {
    if (match.player1 && match.player2) return { player1: match.player1, player2: match.player2 }

    const roundIdx = rounds.indexOf(match.round)
    if (roundIdx <= 0) return { player1: match.player1, player2: match.player2 }

    const prevRound = rounds[roundIdx - 1]
    const prevMatches = matches.filter(m => m.round === prevRound)
    const currentRoundMatches = matches.filter(m => m.round === match.round)
    const matchIdx = currentRoundMatches.indexOf(match)

    let player1: Player | null = match.player1
    let player2: Player | null = match.player2

    if (!player1 && prevMatches[matchIdx * 2]) {
      const r = resultMap.get(prevMatches[matchIdx * 2].matchId)
      if (r) player1 = playerMap.get(r.winner_external_id) ?? { externalId: r.winner_external_id, name: r.winner_external_id, country: '' }
    }
    if (!player2 && prevMatches[matchIdx * 2 + 1]) {
      const r = resultMap.get(prevMatches[matchIdx * 2 + 1].matchId)
      if (r) player2 = playerMap.get(r.winner_external_id) ?? { externalId: r.winner_external_id, name: r.winner_external_id, country: '' }
    }

    return { player1, player2 }
  }

  // Determine which round to auto-expand
  const defaultExpanded = useMemo(() => {
    if (mode === 'results') {
      // Auto-expand the latest round that has results
      for (let i = rounds.length - 1; i >= 0; i--) {
        const roundMatches = matches.filter(m => m.round === rounds[i])
        if (roundMatches.some(m => resultMap.has(m.matchId))) return rounds[i]
      }
      return rounds[0] ?? ''
    } else {
      // Auto-expand the earliest round that has upcoming matches
      for (const round of rounds) {
        const roundMatches = matches.filter(m => m.round === round)
        if (roundMatches.some(m => !resultMap.has(m.matchId))) return round
      }
      return rounds[0] ?? ''
    }
  }, [rounds, matches, resultMap, mode])

  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(new Set([defaultExpanded]))

  function toggleRound(round: string) {
    setExpandedRounds(prev => {
      const next = new Set(prev)
      if (next.has(round)) next.delete(round)
      else next.add(round)
      return next
    })
  }

  // Filter rounds based on mode
  const visibleRounds = rounds.filter(round => {
    const roundMatches = matches.filter(m => m.round === round)
    if (mode === 'results') {
      return roundMatches.some(m => resultMap.has(m.matchId))
    } else {
      return roundMatches.some(m => !resultMap.has(m.matchId))
    }
  })

  if (visibleRounds.length === 0) {
    return (
      <div className="py-12 text-center">
        <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--muted)' }}>
          {mode === 'results' ? 'No results yet.' : 'No upcoming matches.'}
        </p>
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '6px' }}>
          {mode === 'results'
            ? 'Match results will appear here as the tournament progresses.'
            : 'All matches have been completed.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {visibleRounds.map(round => {
        const roundMatches = matches.filter(m => m.round === round)
        const isExpanded = expandedRounds.has(round)

        // Filter matches for this round based on mode
        const displayMatches = mode === 'results'
          ? roundMatches.filter(m => resultMap.has(m.matchId))
          : roundMatches.filter(m => !resultMap.has(m.matchId))

        const completedCount = roundMatches.filter(m => resultMap.has(m.matchId)).length
        const totalCount = roundMatches.length

        return (
          <div key={round}>
            {/* Round header */}
            <button
              type="button"
              onClick={() => toggleRound(round)}
              className="w-full flex items-center justify-between"
              style={{
                background: 'white',
                border: '1px solid var(--chalk-dim)',
                borderRadius: isExpanded ? '4px 4px 0 0' : '4px',
                padding: '12px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0, lineHeight: 1 }}>
                  {ROUND_LABELS[round] ?? round}
                </h2>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.65rem',
                    color: completedCount === totalCount ? '#166534' : 'var(--muted)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {mode === 'results'
                    ? `${completedCount}/${totalCount}`
                    : `${totalCount - completedCount} remaining`}
                </span>
              </div>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: completedCount === totalCount && mode === 'results' ? '#dcfce7' : 'var(--chalk)',
                  color: isExpanded ? 'var(--court)' : 'var(--ink)',
                  fontSize: '0.9rem',
                  flexShrink: 0,
                  transition: 'transform 0.2s ease',
                  transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                }}
              >
                ▾
              </span>
            </button>

            {/* Match list */}
            {isExpanded && (
              <div
                className="flex flex-col gap-1.5"
                style={{
                  border: '1px solid var(--chalk-dim)',
                  borderTop: 'none',
                  borderRadius: '0 0 4px 4px',
                  padding: '12px',
                  background: 'var(--chalk)',
                }}
              >
                {displayMatches.map(match => {
                  const result = resultMap.get(match.matchId)
                  const { player1, player2 } = resolveMatchPlayers(match)
                  const isBye = result?.loser_external_id === 'bye'

                  return (
                    <div
                      key={match.matchId}
                      className="bg-white rounded-sm border p-3"
                      style={{
                        borderColor: result ? '#bbf7d0' : 'var(--chalk-dim)',
                        opacity: isBye ? 0.5 : 1,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {/* Player 1 */}
                        <div
                          className="flex-1 py-1.5 px-2 rounded-sm"
                          style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                            background: result && player1 && result.winner_external_id === player1.externalId ? '#dcfce7' : !player1 ? '#f1f5f9' : 'transparent',
                            color: 'var(--ink)',
                            border: result && player1 && result.winner_external_id === player1.externalId ? '1px solid #86efac' : '1px solid transparent',
                          }}
                        >
                          {player1 ? <>{player1.name} {nameToFlag(player1.country) ?? ''}</> : 'TBD'}
                          {result && player1 && result.winner_external_id === player1.externalId && ' ✓'}
                        </div>

                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', flexShrink: 0 }}>vs</span>

                        {/* Player 2 */}
                        <div
                          className="flex-1 py-1.5 px-2 rounded-sm"
                          style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                            background: result && player2 && result.winner_external_id === player2.externalId ? '#dcfce7' : !player2 ? '#f1f5f9' : 'transparent',
                            color: 'var(--ink)',
                            border: result && player2 && result.winner_external_id === player2.externalId ? '1px solid #86efac' : '1px solid transparent',
                          }}
                        >
                          {player2 ? <>{player2.name} {nameToFlag(player2.country) ?? ''}</> : 'TBD'}
                          {result && player2 && result.winner_external_id === player2.externalId && ' ✓'}
                        </div>

                        {/* Score */}
                        {result?.score && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                            {result.score}
                          </span>
                        )}

                        {/* BYE label */}
                        {isBye && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', fontStyle: 'italic', flexShrink: 0 }}>
                            BYE
                          </span>
                        )}
                      </div>

                      {/* Scheduled time for upcoming matches */}
                      {mode === 'upcoming' && match.scheduledAt && (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '4px', paddingLeft: '8px' }}>
                          {new Date(match.scheduledAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {' · '}
                          {new Date(match.scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
