'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { saveMatchResult, clearMatchResult, setTournamentStatus, revertTournamentCompletion, rebuildTournamentRecap, lockMatches, unlockMatches, lockRound } from '../../../actions'
import { nameToFlag } from '@/app/admin/countries'
import type { PredictionMode } from '@/lib/app-settings'

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
  tournamentLocation?: string | null
  flagEmoji?: string | null
  tournamentStatus: string
  bracketData: {
    rounds: string[]
    matches: DrawMatch[]
  }
  matchResults: MatchResult[]
  lockedMatches: Record<string, string>
  predictionMode: PredictionMode
}

/**
 * The statuses the override dropdown may set.
 *
 * `completed` is deliberately absent in BOTH directions. Completing fires
 * trophies, Perfect Prediction, challenge finalization and invite expiry;
 * un-completing has to undo all four. That is exactly what the Mark complete /
 * Un-complete buttons below do — a dropdown reaching `completed` would fire
 * those triggers from a control that looks like a label change, and one that
 * could leave it would strand the badges already handed out. So the dropdown
 * hides entirely once a tournament is completed.
 */
const SETTABLE_STATUSES = ['upcoming', 'draw_published', 'accepting_predictions', 'in_progress'] as const

const STATUS_LABELS: Record<string, string> = {
  upcoming:              'Upcoming',
  draw_published:        'Draw published — not open yet',
  accepting_predictions: 'Accepting predictions',
  in_progress:           'In progress — live',
  completed:             'Completed',
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
  tournamentLocation,
  flagEmoji,
  tournamentStatus,
  bracketData,
  matchResults: initialResults,
  lockedMatches: initialLocked,
  predictionMode,
}: ResultsEntryProps) {
  const [results, setResults] = useState<MatchResult[]>(initialResults)
  const [savingMatch, setSavingMatch] = useState<string | null>(null)
  const [completeStatus, setCompleteStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' })
  // Separate from completeStatus so a rebuild does not clear the message from a
  // completion that just happened, and vice versa.
  const [recapStatus, setRecapStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' })
  // Third message slot, for the same reason recapStatus is separate: a status
  // override should not wipe the message from a completion or a recap rebuild.
  const [statusChange, setStatusChange] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' })
  // Local mirror of the prop so completing / un-completing swaps the controls
  // without a round trip. The server action is the source of truth; this only
  // moves after it succeeds.
  const [status, setStatus] = useState(tournamentStatus)

  // Tracks which rounds are expanded (all collapsed by default)
  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(new Set())

  // Tracks which matches are in "edit" mode (re-selecting winner)
  const [editingMatches, setEditingMatches] = useState<Set<string>>(new Set())

  // ── Lock state (manual_lock mode) ──
  const isManualLock = predictionMode === 'manual_lock'
  const [locked, setLocked] = useState<Record<string, string>>(initialLocked)
  const [lockingMatch, setLockingMatch] = useState<string | null>(null)
  const [lockingRound, setLockingRound] = useState<string | null>(null)

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

  function getRoundLockProgress(round: string): { locked: number; total: number } {
    const roundMatches = bracketData.matches.filter(m => m.round === round)
    const lockedCount = roundMatches.filter(m => locked[m.matchId]).length
    return { locked: lockedCount, total: roundMatches.length }
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
      const { ok, error, cascadeDeleted } = await saveMatchResult(
        tournamentId,
        match.matchId,
        winnerId,
        loserId,
      )
      if (ok) {
        setResults(prev => {
          // Remove this match + any cascade-deleted downstream matches
          const removedIds = new Set([match.matchId, ...(cascadeDeleted ?? [])])
          const filtered = prev.filter(r => !removedIds.has(r.external_match_id))
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
        if (cascadeDeleted?.length) {
          alert(`Result saved. ${cascadeDeleted.length} downstream result(s) were removed because the winner changed.`)
        }
      } else {
        alert(error ?? 'Failed to save result')
      }
    } finally {
      setSavingMatch(null)
    }
  }

  async function handleClearResult(match: DrawMatch) {
    if (!confirm('Clear this result? Downstream results involving the winner will also be removed.')) return
    setSavingMatch(match.matchId)
    try {
      const { ok, error, cascadeDeleted } = await clearMatchResult(
        tournamentId,
        match.matchId,
      )
      if (ok) {
        setResults(prev => {
          const removedIds = new Set([match.matchId, ...(cascadeDeleted ?? [])])
          return prev.filter(r => !removedIds.has(r.external_match_id))
        })
        setEditingMatches(prev => {
          const next = new Set(prev)
          next.delete(match.matchId)
          return next
        })
        if (cascadeDeleted?.length) {
          alert(`Result cleared. ${cascadeDeleted.length} downstream result(s) were also removed.`)
        }
      } else {
        alert(error ?? 'Failed to clear result')
      }
    } finally {
      setSavingMatch(null)
    }
  }

  async function handleToggleLock(matchId: string) {
    setLockingMatch(matchId)
    try {
      const isLocked = !!locked[matchId]
      const { ok, error } = isLocked
        ? await unlockMatches(tournamentId, [matchId])
        : await lockMatches(tournamentId, [matchId])
      if (ok) {
        setLocked(prev => {
          const next = { ...prev }
          if (isLocked) delete next[matchId]
          else next[matchId] = new Date().toISOString()
          return next
        })
      } else {
        alert(error ?? 'Failed to toggle lock')
      }
    } finally {
      setLockingMatch(null)
    }
  }

  async function handleLockRound(round: string) {
    setLockingRound(round)
    try {
      const { ok, error } = await lockRound(tournamentId, round)
      if (ok) {
        const roundMatchIds = bracketData.matches.filter(m => m.round === round).map(m => m.matchId)
        const now = new Date().toISOString()
        setLocked(prev => {
          const next = { ...prev }
          for (const id of roundMatchIds) {
            if (!next[id]) next[id] = now
          }
          return next
        })
      } else {
        alert(error ?? 'Failed to lock round')
      }
    } finally {
      setLockingRound(null)
    }
  }

  async function handleSetStatus(next: string) {
    if (next === status) return
    const previous = status
    setStatusChange({ type: 'loading' })
    const { ok, error } = await setTournamentStatus(tournamentId, next)
    if (ok) {
      setStatus(next)
      setStatusChange({ type: 'success', message: `Status set to “${STATUS_LABELS[next] ?? next}”` })
    } else {
      // Leave the local mirror where it was: the select reads from `status`, so
      // not moving it is what snaps the dropdown back to reality on a failure.
      setStatus(previous)
      setStatusChange({ type: 'error', message: error ?? 'Failed to change status' })
    }
  }

  async function handleMarkComplete() {
    setCompleteStatus({ type: 'loading' })
    const { ok, error } = await setTournamentStatus(tournamentId, 'completed')
    if (ok) {
      setStatus('completed')
      setCompleteStatus({ type: 'success', message: 'Tournament marked as completed' })
    } else {
      setCompleteStatus({ type: 'error', message: error ?? 'Failed' })
    }
  }

  // Rebuild is manual because the cron deliberately never revisits a recap it
  // has already built: the numbers only change when the results do. This is the
  // path for when they DO change — a score corrected weeks after the fact.
  async function handleRebuildRecap() {
    setRecapStatus({ type: 'loading' })
    const { ok, error } = await rebuildTournamentRecap(tournamentId)
    setRecapStatus(ok
      ? { type: 'success', message: 'Recap rebuilt from the current results' }
      : { type: 'error', message: error ?? 'Failed' })
  }

  async function handleRevertComplete() {
    const confirmed = window.confirm(
      'Un-complete this tournament?\n\n'
      + 'This puts it back to In progress and undoes what completing it triggered:\n'
      + '  • trophies and Perfect Prediction badges for this tournament are removed\n'
      + '  • the badge notifications are deleted too, so players see nothing\n'
      + '  • finalized challenges reopen and expired invites go back to pending\n\n'
      + 'Points, rankings and leagues are NOT touched — those matches were really played.\n'
      + 'Badge emails that already went out cannot be recalled.',
    )
    if (!confirmed) return

    setCompleteStatus({ type: 'loading' })
    const { ok, error, summary } = await revertTournamentCompletion(tournamentId)
    if (ok && summary) {
      setStatus(summary.newStatus)
      setCompleteStatus({
        type: 'success',
        message: `Back to ${summary.newStatus} — ${summary.achievementsRemoved} badge(s), `
          + `${summary.notificationsRemoved} notification(s) removed, `
          + `${summary.challengesReopened} challenge(s) reopened, `
          + `${summary.challengeInvitesRestored} invite(s) restored`,
      })
    } else {
      setCompleteStatus({ type: 'error', message: error ?? 'Failed' })
    }
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      {/* Sticky admin nav */}
      <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Admin
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Results{isManualLock ? ' + Locks' : ''}
          </span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {flagEmoji && <span style={{ marginRight: '6px' }}>{flagEmoji}</span>}
            {tournamentLocation ?? tournamentName}
          </h1>
          {tournamentLocation && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px' }}>{tournamentName}</p>
          )}
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Click on a player to select them as the winner.
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
            Status: {status}
            {isManualLock && (
              <span style={{ marginLeft: '12px', color: '#4338ca', background: '#eef2ff', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.65rem' }}>
                Manual lock mode
              </span>
            )}
          </p>
        </div>

        {bracketData.rounds.map(round => {
          const roundMatches = bracketData.matches.filter(m => m.round === round)
          const { entered, total } = getRoundProgress(round)
          const isExpanded = expandedRounds.has(round)
          const isComplete = entered === total
          const lockProgress = isManualLock ? getRoundLockProgress(round) : null
          const isRoundFullyLocked = lockProgress ? lockProgress.locked === lockProgress.total : false

          return (
            <div key={round} style={{ marginBottom: '10px' }}>
              {/* Round header */}
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
                  {isManualLock && lockProgress && (
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.6rem',
                      color: isRoundFullyLocked ? '#4338ca' : 'var(--muted)',
                      background: isRoundFullyLocked ? '#eef2ff' : 'transparent',
                      padding: isRoundFullyLocked ? '1px 6px' : '0',
                      borderRadius: '9999px',
                    }}>
                      {lockProgress.locked}/{lockProgress.total} locked
                    </span>
                  )}
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
                  {/* Lock entire round button */}
                  {isManualLock && !isRoundFullyLocked && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleLockRound(round) }}
                      disabled={lockingRound === round}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.65rem',
                        color: '#4338ca',
                        background: '#eef2ff',
                        border: '1px solid #c7d2fe',
                        borderRadius: '4px',
                        padding: '6px 12px',
                        cursor: 'pointer',
                        alignSelf: 'flex-start',
                        opacity: lockingRound === round ? 0.5 : 1,
                      }}
                    >
                      {lockingRound === round ? 'Locking...' : `Lock entire ${ROUND_LABELS[round] ?? round}`}
                    </button>
                  )}

                  {roundMatches.map(match => {
                    const result = resultMap.get(match.matchId)
                    const isEditing = editingMatches.has(match.matchId)
                    const { player1, player2 } = resolveMatchPlayers(match)
                    const isBye = result?.loser_external_id === 'bye'
                    const isSaving = savingMatch === match.matchId
                    const isLocked = !!locked[match.matchId]
                    const isLocking = lockingMatch === match.matchId
                    // Playable if both players known and either no result or in edit mode
                    const playable = player1 !== null && player2 !== null && (!result || isEditing)

                    return (
                      <div
                        key={match.matchId}
                        className="bg-white rounded-sm border p-3"
                        style={{
                          borderColor: isLocked && isManualLock
                            ? '#c7d2fe'
                            : result && !isEditing ? '#bbf7d0' : 'var(--chalk-dim)',
                          opacity: isBye && !isEditing ? 0.6 : 1,
                        }}
                      >
                        {/*
                          Wraps because the action buttons cannot shrink. Lock
                          is flexShrink: 0 by necessity — a squashed "Lock"/
                          "Unlock" is unreadable — so in a nowrap row the whole
                          card pushed past the viewport: at 375px the page
                          scrolled sideways by 20px and Lock sat at x=396, half
                          off screen. This is the screen used to enter results
                          during a live tournament, frequently from a phone.

                          Wrapping drops the actions to a second line only when
                          they do not fit, so desktop is unchanged.
                        */}
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Lock indicator */}
                          {isManualLock && isLocked && !isBye && (
                            <span style={{ fontSize: '0.7rem', flexShrink: 0 }} title="Locked — predictions blocked">
                              🔒
                            </span>
                          )}

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
                            {player1 ? <>{player1.name} {nameToFlag(player1.country) ?? ''}</> : 'TBD'}
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
                            {player2 ? <>{player2.name} {nameToFlag(player2.country) ?? ''}</> : 'TBD'}
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

                          {/* Edit + Clear buttons — shown for matches with results that are not currently being edited */}
                          {result && !isEditing && (
                            <div className="flex gap-1">
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
                              <button
                                type="button"
                                onClick={() => handleClearResult(match)}
                                disabled={isSaving}
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
                                Clear
                              </button>
                            </div>
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

                          {/* Lock/unlock toggle — only in manual_lock mode, not for BYEs */}
                          {isManualLock && !isBye && (
                            <button
                              type="button"
                              onClick={() => handleToggleLock(match.matchId)}
                              disabled={isLocking}
                              title={isLocked ? 'Unlock predictions for this match' : 'Lock predictions for this match'}
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.6rem',
                                color: isLocked ? '#4338ca' : 'var(--muted)',
                                background: isLocked ? '#eef2ff' : 'none',
                                border: `1px solid ${isLocked ? '#c7d2fe' : 'var(--chalk-dim)'}`,
                                borderRadius: '2px',
                                padding: '2px 6px',
                                cursor: 'pointer',
                                opacity: isLocking ? 0.5 : 1,
                                flexShrink: 0,
                              }}
                            >
                              {isLocking ? '...' : isLocked ? 'Unlock' : 'Lock'}
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

        {/* ── Status override ──────────────────────────────────────────────
            This page is where you FIND OUT the status is wrong — you are
            entering results for a tournament the site still calls "accepting
            predictions". Until now nothing in the admin UI could set
            `in_progress`: the only writer was an API route with no caller, so
            fixing it meant a POST by hand. Hidden once completed, because from
            there the only safe exit is Un-complete (see SETTABLE_STATUSES). */}
        {status !== 'completed' && (
          <div className="mt-8">
            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="tournament-status"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}
              >
                Status
              </label>
              <select
                id="tournament-status"
                value={status}
                onChange={e => handleSetStatus(e.target.value)}
                disabled={statusChange.type === 'loading'}
                className="px-3 py-2 text-sm rounded-sm border disabled:opacity-40"
                style={{ background: 'white', color: 'var(--ink)', borderColor: 'var(--chalk-dim)' }}
              >
                {SETTABLE_STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
              {statusChange.type === 'loading' && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>Saving…</span>
              )}
            </div>
            {statusChange.message && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: statusChange.type === 'error' ? '#991b1b' : '#166534', marginTop: '8px' }}>
                {statusChange.message}
              </p>
            )}
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.5 }}>
              Entering the first real result sets <strong>In progress</strong> on its own. Reach for this when that has been undone, or to open or close predictions by hand.
            </p>
          </div>
        )}

        {/* Complete / un-complete — with global progress */}
        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            {status === 'completed' ? (
              <button
                onClick={handleRevertComplete}
                disabled={completeStatus.type === 'loading'}
                className="px-6 py-2 text-sm font-medium rounded-sm border transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: 'white', color: '#991b1b', borderColor: '#991b1b' }}
              >
                {completeStatus.type === 'loading' ? 'Reverting...' : 'Un-complete Tournament'}
              </button>
            ) : (
              <button
                onClick={handleMarkComplete}
                disabled={completeStatus.type === 'loading'}
                className="px-6 py-2 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: '#111', color: 'white' }}
              >
                {completeStatus.type === 'loading' ? 'Completing...' : 'Mark Tournament as Completed'}
              </button>
            )}
            {/* Only once completed: the recap reports settled points, and
                before the tournament is over there is nothing to settle. */}
            {status === 'completed' && (
              <button
                onClick={handleRebuildRecap}
                disabled={recapStatus.type === 'loading'}
                className="px-6 py-2 text-sm font-medium rounded-sm border transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: 'white', color: 'var(--ink)', borderColor: 'var(--chalk-dim)' }}
              >
                {recapStatus.type === 'loading' ? 'Building...' : 'Rebuild recap'}
              </button>
            )}
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
          </div>
          {recapStatus.message && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: recapStatus.type === 'error' ? '#991b1b' : '#166534', marginTop: '8px' }}>
              {recapStatus.message}
            </p>
          )}
          {completeStatus.message && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: completeStatus.type === 'error' ? '#991b1b' : '#166534', marginTop: '8px' }}>
              {completeStatus.message}
            </p>
          )}
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.5 }}>
            {status === 'completed'
              ? 'Completed too early? Un-completing puts it back to In progress and silently removes this tournament’s badges, notifications and challenge verdicts. Points are kept.'
              : 'Remember to run Award Points from the admin panel before marking as completed.'}
          </p>
        </div>
      </div>
    </main>
  )
}
