'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { savePrediction, importGlobalPicks } from './actions'
import CountryFlag from '@/components/CountryFlag'

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
  correct:    { bg: '#dcfce7', labelColor: '#166534', labelBg: '#dcfce7', label: '✓ correct'    },
  wrong:      { bg: '#fee2e2', labelColor: '#991b1b', labelBg: '#fee2e2', label: '✗ wrong'      },
  picked:     { bg: '#eaf3de', labelColor: '#27500A', labelBg: '#eaf3de', label: 'picked'        },
  winner:     { bg: '#fffbeb', labelColor: '#92400e', labelBg: '#fffbeb', label: 'winner'        },
  bye:        { bg: '#dbeafe', labelColor: '#1e40af', labelBg: '#dbeafe', label: 'bye'           },
  eliminated: { bg: '#fef2f2', labelColor: '#991b1b', labelBg: '#fee2e2', label: 'eliminated'    },
  none:       { bg: 'white',   labelColor: '',        labelBg: '',        label: ''               },
}

export default function BracketPredictor({
  tournament,
  draw,
  existingPicks,
  predictionId,
  username,
  returnUrl,
  matchResults,
  matchPoints,
  readOnly = false,
  shareUrl,
  pickLocks = {},
  isFullyLocked = false,
  challengeContext,
  onPicksChange,
  hideSaveButtons = false,
  hideBackLink = false,
}: {
  tournament: any
  draw: Draw
  existingPicks: Record<string, string>
  predictionId: string | null
  username: string
  returnUrl?: string
  matchResults?: Record<string, string>            // matchId → winnerExternalId
  matchPoints?: Record<string, { points: number; streakMultiplier: number }>
  readOnly?: boolean
  shareUrl?: string
  pickLocks?: Record<string, string>               // matchId → "auto" | "voluntary" | "auto_lock_all"
  isFullyLocked?: boolean
  challengeContext?: { opponentUsername: string; challengeId: string }
  /** Called whenever picks change — used by anonymous challenge wrapper to track state */
  onPicksChange?: (picks: Record<string, string>) => void
  /** Hides built-in save/lock buttons — anonymous wrapper provides its own submit */
  hideSaveButtons?: boolean
  /** Hides all back/navigation links — used when embedded in anonymous challenge views */
  hideBackLink?: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // ── State ────────────────────────────────────────────────────────────────
  const [picks, setPicks] = useState<Record<string, string>>(existingPicks)
  const [currentPickLocks, setCurrentPickLocks] = useState<Record<string, string>>(pickLocks)
  const [fullyLocked, setFullyLocked] = useState(isFullyLocked)
  const [currentPredictionId, setCurrentPredictionId] = useState<string | null>(predictionId)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [slotError, setSlotError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [showImport, setShowImport] = useState(true)
  const [activeRound, setActiveRound] = useState(() => {
    const sorted = draw.rounds.slice().sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
    return sorted[0] ?? 'QF'
  })

  const sortedRounds = draw.rounds.slice().sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
  const feedMap = buildFeedMap(draw.matches)
  const byeMatchIds = new Set(draw.matches.filter(isByeMatch).map(m => m.matchId))
  const totalMatches = draw.matches.length - byeMatchIds.size
  const pickedCount = Object.keys(picks).filter(id => !byeMatchIds.has(id)).length
  const challengeId = challengeContext?.challengeId ?? null

  // ── Per-match lock state ─────────────────────────────────────────────────
  /** Check if a match is locked (any reason: result, voluntary, full lock) */
  function isMatchLocked(matchId: string): boolean {
    if (readOnly || fullyLocked) return true
    if (matchResults?.[matchId]) return true           // Match has been played
    if (currentPickLocks[matchId]) return true          // Voluntarily locked
    return false
  }

  /** Display state for the match header badge */
  type LockDisplay = 'editable' | 'voluntary_locked' | 'auto_locked' | 'fully_locked' | 'bye'
  function getMatchLockDisplay(matchId: string): LockDisplay {
    if (byeMatchIds.has(matchId)) return 'bye'
    if (readOnly || fullyLocked) return 'fully_locked'
    if (matchResults?.[matchId]) return 'auto_locked'
    if (currentPickLocks[matchId]) return 'voluntary_locked'
    return 'editable'
  }

  // ── Bracket logic ────────────────────────────────────────────────────────

  // Build a reverse feed map: matchId → its feeder matches
  const reverseFeedMap: Record<string, { player1Feeder?: string; player2Feeder?: string }> = {}
  for (const m of draw.matches) {
    const feed = feedMap[m.matchId]
    if (!feed) continue
    if (!reverseFeedMap[feed.nextMatchId]) reverseFeedMap[feed.nextMatchId] = {}
    if (feed.slot === 'player1') reverseFeedMap[feed.nextMatchId].player1Feeder = m.matchId
    if (feed.slot === 'player2') reverseFeedMap[feed.nextMatchId].player2Feeder = m.matchId
  }

  // Build a player lookup from all draw matches
  const allPlayers = new Map<string, Player>()
  for (const m of draw.matches) {
    if (m.player1) allPlayers.set(m.player1.externalId, m.player1)
    if (m.player2) allPlayers.set(m.player2.externalId, m.player2)
  }

  /**
   * Resolve who is in a match slot.
   * Priority: 1) draw data  2) actual result from feeder  3) user pick from feeder  4) null (TBD)
   */
  function getEffectivePlayer(match: DrawMatch, slot: 'player1' | 'player2'): Player | null {
    // 1. Draw data has the player directly (first round, or seeded bye)
    const base = match[slot]
    if (base) return base

    // Find the feeder match for this slot
    const feederMatchId = slot === 'player1'
      ? reverseFeedMap[match.matchId]?.player1Feeder
      : reverseFeedMap[match.matchId]?.player2Feeder

    if (!feederMatchId) return null
    const feederMatch = draw.matches.find(m => m.matchId === feederMatchId)
    if (!feederMatch) return null

    // BYE auto-advance: the non-null player wins automatically
    if (isByeMatch(feederMatch)) {
      return feederMatch.player1 ?? feederMatch.player2
    }

    // 2. Actual result from feeder match → real winner advances
    const feederWinnerId = matchResults?.[feederMatchId]
    if (feederWinnerId) {
      return allPlayers.get(feederWinnerId) ?? { externalId: feederWinnerId, name: feederWinnerId, country: '' }
    }

    // 3. User's pick from feeder match
    const pickedId = picks[feederMatchId]
    if (!pickedId) return null

    // Resolve the picked player — might be directly on the feeder or recursively resolved
    if (feederMatch.player1?.externalId === pickedId) return feederMatch.player1
    if (feederMatch.player2?.externalId === pickedId) return feederMatch.player2

    const p1 = getEffectivePlayer(feederMatch, 'player1')
    const p2 = getEffectivePlayer(feederMatch, 'player2')
    if (p1?.externalId === pickedId) return p1
    if (p2?.externalId === pickedId) return p2

    return null
  }

  const pickWinner = (matchId: string, playerExternalId: string) => {
    if (isMatchLocked(matchId)) return
    if (byeMatchIds.has(matchId)) return  // BYE matches are auto-resolved
    const newPicks = { ...picks, [matchId]: playerExternalId }

    const clearDownstream = (mId: string) => {
      const feed = feedMap[mId]
      if (!feed) return
      const nextMatch = draw.matches.find(m => m.matchId === feed.nextMatchId)
      if (!nextMatch) return
      // Don't clear downstream picks that are already locked
      if (matchResults?.[nextMatch.matchId] || currentPickLocks[nextMatch.matchId]) return
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
    onPicksChange?.(newPicks)
    setSaved(false)
    setSlotError(null)
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  /** Save picks without locking */
  const handleSave = async () => {
    if (readOnly || fullyLocked) return
    setSaving(true)
    setSlotError(null)
    try {
      const result = await savePrediction({
        tournamentId: tournament.id,
        picks,
        predictionId: currentPredictionId,
        challengeId,
      })
      if (result.success) {
        setSaved(true)
        if (result.predictionId) setCurrentPredictionId(result.predictionId)
      } else if (result.error === 'slot_taken') {
        setSlotError(
          `Your ${tournament.tour} slot this week is already taken by ${result.conflictingTournamentName}. ` +
          `You can only enter one ${tournament.tour} tournament per week.`
        )
      } else {
        console.error(result.error === 'played_matches' ? 'Cannot change played matches' : result.message)
      }
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  /** Lock entire bracket (replaces old "Submit & lock") */
  const handleLockAll = async () => {
    if (readOnly || fullyLocked) return
    if (!confirm('Lock all picks? You won\'t be able to change any predictions after locking.')) return
    setSaving(true)
    setSlotError(null)
    try {
      const result = await savePrediction({
        tournamentId: tournament.id,
        picks,
        predictionId: currentPredictionId,
        challengeId,
        lockAll: true,
      })
      if (result.success) {
        setFullyLocked(true)
        setSaved(true)
        if (result.predictionId) setCurrentPredictionId(result.predictionId)
      } else if (result.error === 'slot_taken') {
        setSlotError(
          `Your ${tournament.tour} slot this week is already taken by ${result.conflictingTournamentName}. ` +
          `You can only enter one ${tournament.tour} tournament per week.`
        )
      } else {
        console.error(result.error === 'played_matches' ? 'Cannot change played matches' : result.message)
      }
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  /** Lock a single pick (saves all current picks + locks this match) */
  const handleLockPick = async (matchId: string) => {
    if (isMatchLocked(matchId) || !picks[matchId]) return
    setSaving(true)
    setSlotError(null)
    try {
      const result = await savePrediction({
        tournamentId: tournament.id,
        picks,
        predictionId: currentPredictionId,
        challengeId,
        lockMatchIds: [matchId],
      })
      if (result.success) {
        setCurrentPickLocks(prev => ({ ...prev, [matchId]: 'voluntary' }))
        setSaved(true)
        if (result.predictionId) setCurrentPredictionId(result.predictionId)
      } else {
        console.error('Lock pick failed')
      }
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  /** Import global picks into challenge prediction */
  const handleImportGlobal = async () => {
    if (!challengeId) return
    setImporting(true)
    try {
      const result = await importGlobalPicks(tournament.id)
      if ('picks' in result) {
        // Only import picks for matches that aren't already locked
        const importedPicks: Record<string, string> = {}
        for (const [matchId, playerId] of Object.entries(result.picks)) {
          if (!isMatchLocked(matchId)) {
            importedPicks[matchId] = playerId
          }
        }
        setPicks(prev => ({ ...prev, ...importedPicks }))
        setSaved(false)
      }
    } catch (e) { console.error(e) }
    finally { setImporting(false) }
  }

  const matchesForRound = (round: string) => draw.matches.filter(m => m.round === round)

  // Per-round stats: "done" = picked OR played (no action needed from user)
  function getRoundStats(round: string): { done: number; total: number } {
    const roundMatches = matchesForRound(round)
    let total = 0
    let done = 0
    for (const m of roundMatches) {
      if (byeMatchIds.has(m.matchId)) continue
      total++
      // A match is "done" if the user picked it OR it's already played
      if (picks[m.matchId] || matchResults?.[m.matchId]) done++
    }
    return { done, total }
  }

  // Count correctly picked vs total played (for read-only summary), excluding BYE matches
  const correctPicks = readOnly && matchResults
    ? Object.entries(picks).filter(([matchId, playerId]) => !byeMatchIds.has(matchId) && matchResults[matchId] === playerId).length
    : null
  const totalResultsExcludingByes = matchResults
    ? Object.keys(matchResults).filter(matchId => !byeMatchIds.has(matchId)).length
    : 0

  // Check if we're in challenge mode with empty picks (for import prompt)
  // Only show import banner on first visit (no prediction saved yet) with no picks
  const showImportBanner = !!challengeContext && pickedCount === 0 && !fullyLocked && !readOnly && showImport && !currentPredictionId

  // ── Determine what the editable state really is ──────────────────────────
  const isEditing = !readOnly && !fullyLocked

  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>

      {/* Sticky top block — nav + banners + round tabs */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>

      {/* Nav */}
      <nav className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-6 py-4">
          {/* Logo */}
          <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
            Quiet Please
          </Link>

          <div className="flex items-center gap-2 ml-4">
            {/* Back link (when editing) */}
            {isEditing && !hideBackLink && (
              <Link
                href={returnUrl ?? `/tournaments/${tournament.id}`}
                style={{ fontSize: '0.8rem', color: 'var(--muted)', whiteSpace: 'nowrap', marginRight: '0.25rem' }}
              >
                ← Back
              </Link>
            )}

            {/* Pick counter */}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {readOnly
                ? correctPicks !== null && totalResultsExcludingByes > 0
                  ? `${correctPicks}/${totalResultsExcludingByes} correct`
                  : `${pickedCount} picks`
                : `${pickedCount}/${totalMatches} picks`}
            </span>

            {/* Buttons: depends on state */}
            {readOnly || fullyLocked ? (
              <>
                {fullyLocked && !readOnly && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.05em', color: 'var(--court)', whiteSpace: 'nowrap' }}>
                    LOCKED ✓
                  </span>
                )}
                {!hideBackLink && (
                  <Link
                    href={returnUrl ?? `/tournaments/${tournament.id}`}
                    className="px-3 py-1.5 text-xs rounded-sm border whitespace-nowrap"
                    style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
                  >
                    ← Back
                  </Link>
                )}
              </>
            ) : hideSaveButtons ? null : (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving || pickedCount === 0}
                  className="hidden md:block px-3 py-1.5 text-xs rounded-sm border transition-colors disabled:opacity-40 whitespace-nowrap"
                  style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
                >
                  {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save draft'}
                </button>
                <button
                  onClick={handleLockAll}
                  disabled={saving || pickedCount === 0}
                  className="px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
                  style={{ background: 'var(--court)', color: 'white' }}
                >
                  {saving ? 'Saving…' : 'Lock all picks'}
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Read-only banner (viewing someone else's picks) */}
      {readOnly && (
        <div style={{ background: '#f1efe8', borderBottom: '1px solid var(--chalk-dim)' }}>
          {/* First row: badge + (desktop legend) + share button */}
          <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 md:px-6 py-2.5">
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
          <p className="max-w-5xl mx-auto md:hidden mt-1 px-4 md:px-6 pb-1" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            {matchResults && Object.keys(matchResults).length > 0
              ? 'Green = correct · Red = wrong · Gold = actual winner you missed'
              : 'Results not yet available — check back after matches are played.'}
          </p>
        </div>
      )}

      {/* Round tabs */}
      <div className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {sortedRounds.map(round => {
            const stats = getRoundStats(round)
            const allDone = stats.done === stats.total && stats.total > 0
            return (
              <button
                key={round}
                onClick={() => setActiveRound(round)}
                className="px-5 py-3 text-xs whitespace-nowrap border-b-2 transition-colors flex-shrink-0 flex items-center gap-1.5"
                style={{
                  borderBottomColor: activeRound === round ? 'var(--court)' : 'transparent',
                  color: activeRound === round ? 'var(--court)' : 'var(--muted)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em',
                }}
              >
                {ROUND_LABELS[round] ?? round}
                {!readOnly && stats.total > 0 && (
                  <span style={{
                    fontSize: '0.55rem',
                    padding: '1px 4px',
                    borderRadius: '2px',
                    background: allDone ? '#dbeafe' : 'var(--chalk)',
                    color: allDone ? '#1e40af' : 'var(--muted)',
                  }}>
                    {stats.done}/{stats.total}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      </div>{/* end sticky top block */}

      {/* Header */}
      <div className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-5">
        <div className="flex items-center gap-2 mb-1" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href={`/tournaments/${tournament.id}`} style={{ color: 'var(--muted)' }}>{tournament.flag_emoji ? `${tournament.flag_emoji} ` : ''}{tournament.location ? `${tournament.location} · ${tournament.name}` : tournament.name}</Link>
          <span>/</span>
          <span>
            {readOnly
              ? `${username}'s picks`
              : challengeContext
                ? `Challenge vs ${challengeContext.opponentUsername}`
                : 'Your picks'}
          </span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
          {readOnly
            ? `${username}'s picks`
            : challengeContext
              ? `Challenge vs ${challengeContext.opponentUsername}`
              : 'Make your predictions'}
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
          {readOnly
            ? `View ${username}'s picks round by round.`
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
      </div>

      {/* Matches */}
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">

        {/* Import from global banner (challenge mode with empty picks) */}
        {showImportBanner && (
          <div className="bg-white rounded-sm border p-5 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', marginBottom: '0.25rem' }}>
              How do you want to start?
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.6 }}>
              Import your existing predictions as a starting point, or start fresh for this challenge.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleImportGlobal}
                disabled={importing}
                className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-40"
                style={{ background: 'var(--court)' }}
              >
                {importing ? 'Importing…' : 'Import global picks'}
              </button>
              <button
                onClick={() => setShowImport(false)}
                className="px-4 py-2 text-sm rounded-sm border hover:bg-white transition-colors"
                style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
              >
                Start from scratch
              </button>
            </div>
          </div>
        )}

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
                const matchLocked = isMatchLocked(match.matchId)
                const isClickable = !matchLocked && !!player && !isBye
                return (
                  <button
                    onClick={() => player && pickWinner(match.matchId, player.externalId)}
                    disabled={!player || matchLocked || isBye}
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
                      {player?.country && player.country.toLowerCase() !== 'world' && (
                        <CountryFlag country={player.country} size={16} />
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
                          ? (() => {
                              const mp = matchPoints[match.matchId]
                              const streakLabel = mp.streakMultiplier > 1 ? ` ×${mp.streakMultiplier}` : ''
                              return `✓ +${mp.points} pts${streakLabel}`
                            })()
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
                      const noPlayers = !p1 && !p2
                      const lockDisplay = getMatchLockDisplay(match.matchId)

                      // Dead pick: user picked someone who's been eliminated (not in this match anymore)
                      const deadPick = !isBye && pickedId && p1 && p2
                        && pickedId !== p1.externalId && pickedId !== p2.externalId
                      const deadPickPlayer = deadPick ? allPlayers.get(pickedId) : null

                      // BYE matches: non-null player gets 'bye' state, null side gets 'none'
                      const s1 = isBye ? (match.player1 ? 'bye' as const : 'none' as const) : getPickState(deadPick ? undefined : pickedId, p1?.externalId, actualWinnerId)
                      const s2 = isBye ? (match.player2 ? 'bye' as const : 'none' as const) : getPickState(deadPick ? undefined : pickedId, p2?.externalId, actualWinnerId)

                      // Show per-pick lock button? Only if: editable, has a valid (non-dead) pick, not saving
                      const showLockBtn = lockDisplay === 'editable' && !!pickedId && !isBye && !deadPick

                      return (
                        <div key={match.matchId} className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: isBye ? '#bfdbfe' : 'var(--chalk-dim)' }}>
                          {/* Match header */}
                          <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: isBye ? '#bfdbfe' : 'var(--chalk-dim)', background: isBye ? '#eff6ff' : '#fafaf8' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: isBye ? '#1e40af' : 'var(--muted)', letterSpacing: '0.05em' }}>
                              MATCH {i + 1}{isBye ? ' · BYE' : ''}
                            </span>

                            {/* Dead pick indicator */}
                            {deadPick && (
                              <span style={{
                                fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.04em',
                                color: '#991b1b', background: '#fee2e2', padding: '1px 6px', borderRadius: '2px',
                              }}>
                                {deadPickPlayer?.name ?? 'Your pick'} eliminated
                              </span>
                            )}

                            {/* Lock status / hint */}
                            {!deadPick && (lockDisplay === 'voluntary_locked' || lockDisplay === 'fully_locked') && (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.05em', color: 'var(--court)' }}>
                                LOCKED ✓
                              </span>
                            )}
                            {!deadPick && lockDisplay === 'auto_locked' && (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.05em', color: 'var(--muted)' }}>
                                PLAYED
                              </span>
                            )}
                            {!deadPick && showLockBtn && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleLockPick(match.matchId) }}
                                disabled={saving}
                                className="px-2 py-0.5 rounded-sm border transition-colors hover:border-gray-400 disabled:opacity-40"
                                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.04em', color: 'var(--muted)', borderColor: 'var(--chalk-dim)', background: 'white' }}
                              >
                                Lock pick
                              </button>
                            )}
                            {!deadPick && noPlayers && !readOnly && !isBye && lockDisplay === 'editable' && (
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

        {/* Submit area — editing mode only (hidden when parent provides own buttons) */}
        {isEditing && !hideSaveButtons && (
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
                <button
                  onClick={handleSave}
                  disabled={saving || pickedCount === 0}
                  className="px-5 py-2.5 text-sm rounded-sm border transition-colors disabled:opacity-40"
                  style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
                >
                  {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save draft'}
                </button>
                <button
                  onClick={handleLockAll}
                  disabled={saving || pickedCount === 0}
                  className="px-5 py-2.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: 'var(--court)', color: 'white' }}
                >
                  {saving ? 'Locking…' : 'Lock all picks'}
                </button>
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              Once locked, your picks cannot be changed. You can also lock individual picks using the &quot;Lock pick&quot; button on each match.
            </p>
          </div>
        )}

        {/* Locked confirmation (just locked during this session) */}
        {fullyLocked && !readOnly && (
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
              {challengeContext ? 'Back to challenge →' : 'Back to tournament →'}
            </Link>
          </div>
        )}

        {/* Read-only back link */}
        {readOnly && !hideBackLink && (
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
