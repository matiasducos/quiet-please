'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { savePrediction } from './actions'

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

const ROUND_LABELS: Record<string, string> = {
  R128: 'R128', R64: 'R64', R32: 'R32',
  R16: 'R16', QF: 'Quarterfinals', SF: 'Semifinals', F: 'Final',
}

// Used in prose descriptions — full "Round of N" wording
const ROUND_PROSE: Record<string, string> = {
  R128: 'the Round of 128', R64: 'the Round of 64', R32: 'the Round of 32',
  R16: 'the Round of 16', QF: 'the Quarterfinals', SF: 'the Semifinals', F: 'the Final',
}

const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']

/** A BYE match has exactly one real player and one null slot */
function isByeMatch(match: DrawMatch): boolean {
  return (match.player1 !== null && match.player2 === null) ||
         (match.player1 === null && match.player2 !== null)
}

function buildFeedMap(matches: DrawMatch[]) {
  const byRound: Record<string, DrawMatch[]> = {}
  for (const m of matches) {
    if (!byRound[m.round]) byRound[m.round] = []
    byRound[m.round].push(m)
  }

  const feedMap: Record<string, { nextMatchId: string; slot: 'player1' | 'player2' }> = {}

  const rounds = ROUND_ORDER.filter(r => byRound[r])
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    const currentRound = rounds[ri]
    const nextRound = rounds[ri + 1]
    const current = byRound[currentRound]
    const next = byRound[nextRound]
    if (!next?.length) continue

    for (let i = 0; i < current.length; i++) {
      const nextMatchIndex = Math.floor(i / 2)
      const slot = i % 2 === 0 ? 'player1' : 'player2'
      if (next[nextMatchIndex]) {
        feedMap[current[i].matchId] = { nextMatchId: next[nextMatchIndex].matchId, slot }
      }
    }
  }

  return feedMap
}

// Derive pick color state for a player slot
function getPickState(
  pickedId: string | undefined,
  playerExternalId: string | undefined,
  actualWinnerId: string | undefined,
): 'correct' | 'wrong' | 'picked' | 'winner' | 'none' {
  if (!playerExternalId) return 'none'
  const pickedThis = pickedId === playerExternalId
  if (pickedThis && actualWinnerId) return actualWinnerId === playerExternalId ? 'correct' : 'wrong'
  if (pickedThis) return 'picked'
  if (actualWinnerId === playerExternalId) return 'winner'
  return 'none'
}

const PICK_STYLES: Record<string, { bg: string; labelColor: string; labelBg: string; label: string }> = {
  correct: { bg: '#dcfce7', labelColor: '#166534', labelBg: '#dcfce7', label: '✓ correct' },
  wrong:   { bg: '#fee2e2', labelColor: '#991b1b', labelBg: '#fee2e2', label: '✗ wrong'   },
  picked:  { bg: '#eaf3de', labelColor: '#27500A', labelBg: '#eaf3de', label: 'picked'     },
  winner:  { bg: '#fffbeb', labelColor: '#92400e', labelBg: '#fffbeb', label: 'winner'     },
  bye:     { bg: '#dbeafe', labelColor: '#1e40af', labelBg: '#dbeafe', label: 'bye'        },
  none:    { bg: 'white',   labelColor: '',        labelBg: '',        label: ''            },
}

export default function BracketPredictor({
  tournament,
  draw,
  existingPicks,
  predictionId,
  returnUrl,
  isPractice = false,
  matchResults,
  matchPoints,
  readOnly = false,
  shareUrl,
  onSimulateSubmit,
  customBanner,
}: {
  tournament: any
  draw: Draw
  existingPicks: Record<string, string>
  predictionId: string | null
  username: string
  returnUrl?: string
  isPractice?: boolean
  matchResults?: Record<string, string>  // matchId → winnerExternalId
  matchPoints?: Record<string, number>   // matchId → points earned
  readOnly?: boolean
  shareUrl?: string
  /** Sandbox: intercept Submit & lock, receive picks without writing to DB */
  onSimulateSubmit?: (picks: Record<string, string>) => void
  /** Sandbox: custom banner replacing the practice/readOnly banner */
  customBanner?: React.ReactNode
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [picks, setPicks] = useState<Record<string, string>>(existingPicks)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [locked, setLocked] = useState(false)
  const [slotError, setSlotError] = useState<string | null>(null)
  const [activeRound, setActiveRound] = useState(() => {
    const sorted = draw.rounds.slice().sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
    return sorted[0] ?? 'QF'
  })

  const sortedRounds = draw.rounds.slice().sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
  const feedMap = buildFeedMap(draw.matches)
  const byeMatchIds = new Set(draw.matches.filter(isByeMatch).map(m => m.matchId))
  const totalMatches = draw.matches.length - byeMatchIds.size
  const pickedCount = Object.keys(picks).filter(id => !byeMatchIds.has(id)).length

  function getEffectivePlayer(match: DrawMatch, slot: 'player1' | 'player2'): Player | null {
    const base = match[slot]
    if (base) return base

    const prevMatch = draw.matches.find(m => {
      const feed = feedMap[m.matchId]
      return feed?.nextMatchId === match.matchId && feed?.slot === slot
    })

    if (!prevMatch) return null

    // BYE auto-advance: the non-null player wins automatically, no pick needed
    if (isByeMatch(prevMatch)) {
      return prevMatch.player1 ?? prevMatch.player2
    }

    const pickedId = picks[prevMatch.matchId]
    if (!pickedId) return null

    if (prevMatch.player1?.externalId === pickedId) return prevMatch.player1
    if (prevMatch.player2?.externalId === pickedId) return prevMatch.player2

    const p1 = getEffectivePlayer(prevMatch, 'player1')
    const p2 = getEffectivePlayer(prevMatch, 'player2')
    if (p1?.externalId === pickedId) return p1
    if (p2?.externalId === pickedId) return p2

    return null
  }

  const pickWinner = (matchId: string, playerExternalId: string) => {
    if (readOnly) return
    if (byeMatchIds.has(matchId)) return  // BYE matches are auto-resolved
    const newPicks = { ...picks, [matchId]: playerExternalId }

    const clearDownstream = (mId: string) => {
      const feed = feedMap[mId]
      if (!feed) return
      const nextMatch = draw.matches.find(m => m.matchId === feed.nextMatchId)
      if (!nextMatch) return
      const nextPick = newPicks[nextMatch.matchId]
      if (nextPick) {
        const p1 = getEffectivePlayer(nextMatch, 'player1')
        const p2 = getEffectivePlayer(nextMatch, 'player2')
        const validIds = [p1?.externalId, p2?.externalId].filter(Boolean)
        if (!validIds.includes(nextPick)) {
          delete newPicks[nextMatch.matchId]
          clearDownstream(nextMatch.matchId)
        }
      }
    }
    clearDownstream(matchId)

    setPicks(newPicks)
    setSaved(false)
    setSlotError(null)
  }

  const handleSave = async () => {
    if (isPractice || readOnly || onSimulateSubmit) return  // no-op in sandbox simulation mode
    setSaving(true)
    setSlotError(null)
    try {
      const result = await savePrediction({ tournamentId: tournament.id, picks, predictionId })
      if (result.success) {
        setSaved(true)
      } else if (result.error === 'slot_taken') {
        setSlotError(
          `Your ${tournament.tour} slot this week is already taken by ${result.conflictingTournamentName}. ` +
          `You can only enter one ${tournament.tour} tournament per week.`
        )
      } else {
        console.error(result.message)
      }
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  const handleSubmit = async () => {
    if (readOnly) return
    // Sandbox simulation mode — hand picks back to parent, skip DB write
    if (onSimulateSubmit) {
      onSimulateSubmit(picks)
      return
    }
    const msg = isPractice
      ? 'Score your picks against the actual results? This will show you how many points you would have earned.'
      : 'Lock your picks? This cannot be undone.'
    if (!confirm(msg)) return
    setSaving(true)
    setSlotError(null)
    try {
      const result = await savePrediction({ tournamentId: tournament.id, picks, predictionId, lock: true, isPractice })
      if (result.success) {
        if (isPractice) {
          startTransition(() => router.push(returnUrl ?? `/tournaments/${tournament.id}`))
        } else {
          setLocked(true)
          setSaving(false)
        }
      } else if (result.error === 'slot_taken') {
        setSlotError(
          `Your ${tournament.tour} slot this week is already taken by ${result.conflictingTournamentName}. ` +
          `You can only enter one ${tournament.tour} tournament per week.`
        )
        setSaving(false)
      } else {
        console.error(result.message)
        setSaving(false)
      }
    } catch (e) { console.error(e); setSaving(false) }
  }

  const matchesForRound = (round: string) => draw.matches.filter(m => m.round === round)

  // Count correctly picked vs total picked (for read-only summary)
  const correctPicks = readOnly && matchResults
    ? Object.entries(picks).filter(([matchId, playerId]) => matchResults[matchId] === playerId).length
    : null

  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>

      {/* Sticky top block — nav + banner + round tabs */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>

      {/* Nav */}
      <nav className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-4">
          {/* Logo — always standalone top-left */}
          <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
            Quiet Please
          </Link>

          <div className="flex items-center gap-2 ml-4">
            {/* Back link for non-readOnly mode */}
            {!readOnly && (
              <Link
                href={returnUrl ?? `/tournaments/${tournament.id}`}
                style={{ fontSize: '0.8rem', color: 'var(--muted)', whiteSpace: 'nowrap', marginRight: '0.25rem' }}
              >
                ← Back
              </Link>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {readOnly
                ? correctPicks !== null && matchResults && Object.keys(matchResults).length > 0
                  ? `${correctPicks}/${Object.keys(matchResults).length} correct`
                  : `${pickedCount} picks`
                : `${pickedCount}/${totalMatches} picks`}
            </span>
            {readOnly || locked ? (
              <>
                {locked && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.05em', color: 'var(--court)', whiteSpace: 'nowrap' }}>
                    LOCKED ✓
                  </span>
                )}
                <Link
                  href={returnUrl ?? `/tournaments/${tournament.id}`}
                  className="px-3 py-1.5 text-xs rounded-sm border whitespace-nowrap"
                  style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
                >
                  ← Back
                </Link>
              </>
            ) : (
              <>
                {!isPractice && (
                  <button
                    onClick={handleSave}
                    disabled={saving || pickedCount === 0}
                    className="hidden md:block px-3 py-1.5 text-xs rounded-sm border transition-colors disabled:opacity-40 whitespace-nowrap"
                    style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
                  >
                    {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save draft'}
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={saving || pickedCount === 0}
                  className="px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
                  style={{ background: isPractice ? '#7c2d7c' : 'var(--court)', color: 'white' }}
                >
                  {saving ? 'Scoring…' : isPractice ? 'Score my picks' : 'Submit & lock'}
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Custom banner — sandbox simulation mode (replaces practice/readOnly banners) */}
      {customBanner}

      {/* Practice mode banner */}
      {isPractice && !readOnly && !customBanner && (
        <div className="px-4 md:px-6 py-2.5" style={{ background: '#f3e8ff', borderBottom: '1px solid #e9d5ff' }}>
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: '#7c2d7c', fontWeight: 600, flexShrink: 0 }}>
              PRACTICE MODE
            </span>
            <span className="hidden md:inline" style={{ fontSize: '0.75rem', color: '#6b21a8' }}>
              This tournament is over. Pick your bracket and see how many points you would have earned — no points are awarded.
            </span>
          </div>
          <p className="md:hidden mt-1" style={{ fontSize: '0.75rem', color: '#6b21a8' }}>
            This tournament is over. Pick your bracket and see how many points you would have earned — no points are awarded.
          </p>
        </div>
      )}

      {/* Read-only banner */}
      {readOnly && !customBanner && (
        <div className="px-4 md:px-6 py-2.5" style={{ background: '#f1efe8', borderBottom: '1px solid var(--chalk-dim)' }}>
          {/* First row: badge + (desktop legend) + share button */}
          <div className="flex items-center gap-3">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', fontWeight: 600, flexShrink: 0 }}>
              LOCKED PICKS
            </span>
            {/* Legend inline — desktop only */}
            <span className="hidden md:inline" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              {matchResults && Object.keys(matchResults).length > 0
                ? 'Green = correct · Red = wrong · Gold = actual winner you missed'
                : 'Results not yet available — check back after matches are played.'}
            </span>
            {shareUrl && (
              <button
                onClick={() => {
                  const url = `${window.location.origin}${shareUrl}`
                  navigator.clipboard.writeText(url).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  })
                }}
                className="ml-auto px-3 py-1 rounded-sm border text-xs transition-colors flex-shrink-0"
                style={{ borderColor: 'var(--chalk-dim)', color: copied ? 'var(--court)' : 'var(--muted)', background: 'white' }}
              >
                {copied ? 'Copied!' : 'Share picks'}
              </button>
            )}
          </div>
          {/* Legend below — mobile only */}
          <p className="md:hidden mt-1" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            {matchResults && Object.keys(matchResults).length > 0
              ? 'Green = correct · Red = wrong · Gold = actual winner you missed'
              : 'Results not yet available — check back after matches are played.'}
          </p>
        </div>
      )}

      {/* Round tabs */}
      <div className="flex border-b bg-white overflow-x-auto" style={{ borderColor: 'var(--chalk-dim)', scrollbarWidth: 'none' }}>
        {sortedRounds.map(round => (
          <button
            key={round}
            onClick={() => setActiveRound(round)}
            className="px-5 py-3 text-xs whitespace-nowrap border-b-2 transition-colors flex-shrink-0"
            style={{
              borderBottomColor: activeRound === round ? 'var(--court)' : 'transparent',
              color: activeRound === round ? 'var(--court)' : 'var(--muted)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            {ROUND_LABELS[round] ?? round}
          </button>
        ))}
      </div>

      </div>{/* end sticky top block */}

      {/* Header */}
      <div className="px-4 md:px-6 py-5 border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="flex items-center gap-2 mb-1" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href={`/tournaments/${tournament.id}`} style={{ color: 'var(--muted)' }}>{tournament.name}</Link>
          <span>/</span>
          <span>{readOnly ? 'Your picks' : isPractice ? 'Practice picks' : 'Your picks'}</span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
          {readOnly ? 'Your locked picks' : isPractice ? 'Practice your bracket' : 'Make your predictions'}
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
          {readOnly
            ? 'View your picks round by round.'
            : (() => {
                const firstRound = sortedRounds[0]
                const lastRound = sortedRounds[sortedRounds.length - 1]
                const firstLabel = ROUND_PROSE[firstRound] ?? firstRound
                const lastLabel = ROUND_PROSE[lastRound] ?? lastRound
                if (sortedRounds.length === 1) return `Pick the winner of ${lastLabel}.`
                return `Pick winners round by round. Your picks from ${firstLabel} carry through to ${lastLabel}.`
              })()
          }
        </p>
      </div>

      {/* Matches */}
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">
        <div className="flex flex-col gap-6">
          {(() => {
            // Group matches that share the same next-round match (bracket pairs)
            const roundMatches = matchesForRound(activeRound)
            const seen = new Set<string>()
            const groups: DrawMatch[][] = []
            for (const match of roundMatches) {
              if (seen.has(match.matchId)) continue
              seen.add(match.matchId)
              const myFeed = feedMap[match.matchId]
              if (!myFeed) { groups.push([match]); continue }
              const sibling = roundMatches.find(m =>
                !seen.has(m.matchId) && feedMap[m.matchId]?.nextMatchId === myFeed.nextMatchId
              )
              if (sibling) {
                seen.add(sibling.matchId)
                // Ensure player1-slot match is first
                groups.push(myFeed.slot === 'player1' ? [match, sibling] : [sibling, match])
              } else {
                groups.push([match])
              }
            }

            let matchIndex = 0
            return groups.map((group, gi) => {
              const renderPlayer = (
                match: DrawMatch,
                player: Player | null,
                slot: 'player1' | 'player2',
                state: ReturnType<typeof getPickState> | 'bye',
                withBorderBottom: boolean,
              ) => {
                const style = PICK_STYLES[state]
                const isBye = byeMatchIds.has(match.matchId)
                const isClickable = !readOnly && !locked && !!player && !isBye
                return (
                  <button
                    onClick={() => player && pickWinner(match.matchId, player.externalId)}
                    disabled={!player || readOnly || locked || isBye}
                    className={`pick-btn w-full flex items-center justify-between px-4 py-4 text-left${withBorderBottom ? ' border-b' : ''}`}
                    style={{
                      borderColor: 'var(--chalk-dim)',
                      background: style.bg,
                      cursor: isClickable ? 'pointer' : 'default',
                      opacity: !player ? 0.35 : 1,
                    }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {player?.seed ? (
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.6rem',
                          fontWeight: 600,
                          color: 'white',
                          background: '#5a5a4a',
                          minWidth: '18px',
                          height: '18px',
                          borderRadius: '2px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}>{player.seed}</span>
                      ) : (
                        <span style={{ minWidth: '18px', flexShrink: 0 }} />
                      )}
                      <span className="truncate" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', letterSpacing: '-0.01em', color: player ? 'var(--ink)' : 'var(--muted)' }}>
                        {player?.name ?? (isBye ? 'BYE' : 'TBD')}
                      </span>
                      {player?.country && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', flexShrink: 0, letterSpacing: '0.04em' }}>{player.country}</span>
                      )}
                    </div>
                    {state !== 'none' && (
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.7rem',
                        color: style.labelColor,
                        background: style.labelBg,
                        padding: '2px 8px',
                        borderRadius: '2px',
                        flexShrink: 0,
                        marginLeft: '8px',
                        border: state === 'winner' ? '1px solid #fcd34d' : undefined,
                      }}>
                        {state === 'correct' && matchPoints?.[match.matchId] != null
                          ? '✓ +' + matchPoints[match.matchId] + ' pts'
                          : style.label}
                      </span>
                    )}
                  </button>
                )
              }

              return (
                <div key={gi} className="flex items-stretch">
                  {/* Match cards column */}
                  <div className="flex flex-col gap-3 flex-1">
                    {group.map((match) => {
                      const i = matchIndex++
                      const isBye = byeMatchIds.has(match.matchId)
                      const p1 = getEffectivePlayer(match, 'player1')
                      const p2 = getEffectivePlayer(match, 'player2')
                      const pickedId = picks[match.matchId]
                      const actualWinnerId = matchResults?.[match.matchId]
                      const isLocked = !p1 && !p2
                      // BYE matches: non-null player gets 'bye' state (light blue), null side gets 'none'
                      const s1 = isBye ? (match.player1 ? 'bye' as const : 'none' as const) : getPickState(pickedId, p1?.externalId, actualWinnerId)
                      const s2 = isBye ? (match.player2 ? 'bye' as const : 'none' as const) : getPickState(pickedId, p2?.externalId, actualWinnerId)

                      return (
                        <div key={match.matchId} className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: isBye ? '#bfdbfe' : 'var(--chalk-dim)' }}>
                          <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: isBye ? '#bfdbfe' : 'var(--chalk-dim)', background: isBye ? '#eff6ff' : '#fafaf8' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: isBye ? '#1e40af' : 'var(--muted)', letterSpacing: '0.05em' }}>
                              MATCH {i + 1}{isBye ? ' · BYE' : ''}
                            </span>
                            {isLocked && !readOnly && !isBye && (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                                {activeRound === sortedRounds[0] ? 'Players not available yet' : 'Pick earlier rounds first'}
                              </span>
                            )}
                          </div>

                          {renderPlayer(match, p1, 'player1', s1, true)}

                          <div className="flex items-center justify-center py-1" style={{ background: '#fafaf8' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.1em' }}>VS</span>
                          </div>

                          {renderPlayer(match, p2, 'player2', s2, false)}
                        </div>
                      )
                    })}
                  </div>

                  {/* Bracket connector — right-side ⊣ shape linking the two matches that feed the same next-round slot */}
                  {group.length === 2 && (
                    <div style={{ width: '20px', position: 'relative', flexShrink: 0, alignSelf: 'stretch' }}>
                      <div style={{
                        position: 'absolute',
                        top: '25%',
                        bottom: '25%',
                        left: '4px',
                        right: 0,
                        borderTop: '1.5px solid var(--muted)',
                        borderRight: '1.5px solid var(--muted)',
                        borderBottom: '1.5px solid var(--muted)',
                        borderRadius: '0 3px 3px 0',
                      }} />
                    </div>
                  )}
                </div>
              )
            })
          })()}
        </div>

        {/* Round navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => {
              const idx = sortedRounds.indexOf(activeRound)
              if (idx > 0) setActiveRound(sortedRounds[idx - 1])
            }}
            disabled={sortedRounds.indexOf(activeRound) === 0}
            className="px-4 py-2 text-sm rounded-sm border transition-colors disabled:opacity-30"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
          >
            ← Previous
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
            {ROUND_LABELS[activeRound] ?? activeRound}
          </span>
          <button
            onClick={() => {
              const idx = sortedRounds.indexOf(activeRound)
              if (idx < sortedRounds.length - 1) setActiveRound(sortedRounds[idx + 1])
            }}
            disabled={sortedRounds.indexOf(activeRound) === sortedRounds.length - 1}
            className="px-4 py-2 text-sm rounded-sm border transition-colors disabled:opacity-30"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
          >
            Next →
          </button>
        </div>

        {/* Submit area — hidden in readOnly mode */}
        {!readOnly && !locked && (
          <div className="mt-8 pt-6 border-t flex flex-col gap-3" style={{ borderColor: 'var(--chalk-dim)' }}>
            {/* Slot conflict error */}
            {slotError && (
              <div className="rounded-sm px-4 py-3 text-sm" style={{ background: '#fdecea', color: '#c84b31', border: '1px solid #f5c0b8', fontFamily: 'var(--font-mono)' }}>
                {slotError}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
                {pickedCount} of {totalMatches} picks made
              </span>
              <div className="flex gap-3">
                {!isPractice && (
                  <button
                    onClick={handleSave}
                    disabled={saving || pickedCount === 0}
                    className="px-5 py-2.5 text-sm rounded-sm border transition-colors disabled:opacity-40"
                    style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
                  >
                    {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save draft'}
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={saving || pickedCount === 0}
                  className="px-5 py-2.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: isPractice ? '#7c2d7c' : 'var(--court)', color: 'white' }}
                >
                  {saving ? (isPractice ? 'Scoring…' : 'Submitting…') : isPractice ? 'Score my picks' : 'Submit & lock picks'}
                </button>
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              {isPractice
                ? 'Your score is calculated immediately against actual results. No points are awarded.'
                : 'Once locked, your picks cannot be changed.'}
            </p>
          </div>
        )}

        {/* Locked confirmation */}
        {locked && (
          <div className="mt-8 pt-6 border-t text-center flex flex-col items-center gap-3" style={{ borderColor: 'var(--chalk-dim)' }}>
            <div className="flex items-center gap-2">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', letterSpacing: '0.06em', color: 'var(--court)', fontWeight: 600 }}>
                PICKS LOCKED ✓
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', maxWidth: '360px' }}>
              Your bracket is set. Good luck!
            </p>
            <Link
              href={returnUrl ?? `/tournaments/${tournament.id}`}
              className="px-5 py-2.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90"
              style={{ background: 'var(--court)', color: 'white', textDecoration: 'none' }}
            >
              Back to tournament →
            </Link>
          </div>
        )}

        {/* Read-only back link */}
        {readOnly && (
          <div className="mt-8 pt-6 border-t text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <Link
              href={returnUrl ?? `/tournaments/${tournament.id}`}
              style={{ fontSize: '0.875rem', color: 'var(--court)' }}
            >
              ← Back to tournament
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
