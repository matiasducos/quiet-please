'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { savePrediction, importGlobalPicks } from './actions'
import CountryFlag from '@/components/CountryFlag'
import Tooltip from '@/components/Tooltip'
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation'
import { findForfeitedRounds, listRounds, toGapMatches } from '@/lib/tennis/pick-gaps'
import { calculateStreakMultiplier, committedPicks } from '@/lib/tennis/points'
import type { DrawMatch as LibDrawMatch } from '@/lib/tennis/types'

// Small "i in a circle" affordance placed next to tooltip-bearing tags.
// Inherits color from parent via currentColor so it adapts to each tag's palette.
function InfoIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, opacity: 0.65, marginLeft: 3 }}
    >
      <circle cx="8" cy="8" r="6.8" stroke="currentColor" strokeWidth="1.3" />
      <line x1="8" y1="7.2" x2="8" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.6" r="0.95" fill="currentColor" />
    </svg>
  )
}

const PlayerStatsDrawer = dynamic(() => import('@/components/PlayerStatsDrawer'), {
  ssr: false,
  loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>Loading your record…</div>,
})

const H2HDrawer = dynamic(() => import('@/components/H2HDrawer'), {
  ssr: false,
  loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>Loading H2H data…</div>,
})

/**
 * H2H is hidden until it is backed by real data — getH2HData() still returns
 * deterministic mock records, and presenting invented meetings as history is
 * worse than showing nothing. The drawer and its plumbing are left intact:
 * flip this to true once a real source is wired up.
 */
const SHOW_H2H: boolean = false

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

/**
 * Mobile round labels.
 *
 * ROUND_LABELS is inconsistent by design — short codes for the early rounds,
 * full words for the late ones — and that mix is what made the tab strip
 * 252px wider than a 375px screen, with "Final" sitting at x=611. Tennis
 * already has standard shorthand for the three long ones, so the narrow case
 * uses it rather than truncating or scrolling.
 */
const SHORT_ROUND_LABELS: Record<string, string> = {
  ...ROUND_LABELS, QF: 'QF', SF: 'SF', F: 'F',
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

/**
 * A slot filled from the user's own pick rather than a played result.
 *
 * Deliberately a PATTERN and not another colour: every colour in PICK_STYLES
 * already means an outcome (correct, wrong, winner, eliminated), so a new wash
 * would read as a fifth outcome. Hatching is orthogonal to all of them — it can
 * sit on top of any of those backgrounds and still say the same thing, which is
 * "this name is provisional", not "this result is good or bad".
 *
 * Low contrast on purpose: it passes behind a player's name at every zoom level
 * the bracket offers, so it has to stay legible rather than decorative.
 */
const PROJECTED_HATCH =
  'repeating-linear-gradient(135deg, rgba(90,90,74,0.10) 0 1px, transparent 1px 10px)'

/**
 * Minimap palette.
 *
 * Deliberately not PICK_STYLES: those are pale washes tuned to sit behind a
 * player's name across a full-width row. At a 7px cell they read as off-white
 * against the chalk background and the whole strip turns to mush, so the
 * minimap uses saturated versions of the same hues.
 */
type MinimapState = 'correct' | 'wrong' | 'void' | 'picked' | 'empty' | 'bye'

/** Ordered for the legend: how a pick ends up, best outcome first. */
const MINIMAP_LEGEND: [MinimapState, string][] = [
  ['correct', 'correct'],
  ['wrong',   'wrong'],
  ['void',    'dead pick'],
  ['picked',  'picked'],
  ['empty',   'no pick'],
  ['bye',     'bye'],
]

const MINIMAP_COLORS: Record<MinimapState, string> = {
  correct: '#16a34a',  // you got it right
  wrong:   '#dc2626',  // played, you missed it
  void:    '#d97706',  // your pick lost upstream — this can never score
  picked:  '#64748b',  // committed, not yet played
  empty:   '#e2e0d9',  // no pick
  bye:     '#bfdbfe',  // BYE, nothing to pick
}

/**
 * Three display densities for the round list.
 *
 * The bracket is one vertical column by design, so "zoom" here means how much
 * vertical space a match card spends, not a canvas transform. R128 is 64 cards
 * in a single file — at `roomy` that is a very long scroll, and the point of
 * `dense` is to get a whole round close to one screen.
 *
 * The connectors need no entry here: they are positioned in percentages
 * against the group's stretched height, so they rescale on their own.
 */
type Density = 'roomy' | 'compact' | 'dense'

const DENSITY_ORDER: Density[] = ['dense', 'compact', 'roomy']

/**
 * Default density per round.
 *
 * Density is really a function of how many matches the round holds. The early
 * rounds are long scrolls where seeing more at once is the whole point, so they
 * open compact. The semifinals and final are two matches and one — they fit on
 * any screen at any density, so compressing them buys nothing and only makes
 * the tournament's most-looked-at matches smaller than they deserve.
 *
 * This is only the starting point: the moment the reader touches the zoom
 * control their choice takes over for the rest of the session (see
 * `densityOverride`), because a per-round default that kept reasserting itself
 * on every tab change would make the control feel broken.
 */
const ROOMY_ROUNDS = new Set(['SF', 'F'])

function defaultDensityForRound(round: string): Density {
  return ROOMY_ROUNDS.has(round) ? 'roomy' : 'compact'
}

const DENSITY: Record<Density, {
  label: string
  groupGap: string
  cardGap: string
  headerPadY: string
  playerPadY: string
  nameSize: string
  labelSize: string
  flagSize: number
  seedBox: string
  seedSize: string
  /* The VS strip carries the STATS button, so dropping it costs a feature.
     Only `dense` — the deliberate overview level — pays that price. */
  showVsRow: boolean
}> = {
  roomy:   { label: 'Roomy',   groupGap: '1.5rem',  cardGap: '0.5rem',   headerPadY: '6px', playerPadY: '8px', nameSize: '0.95rem', labelSize: '0.7rem',  flagSize: 14, seedBox: '16px', seedSize: '0.55rem', showVsRow: true },
  compact: { label: 'Compact', groupGap: '1rem',    cardGap: '0.375rem', headerPadY: '3px', playerPadY: '4px', nameSize: '0.85rem', labelSize: '0.65rem', flagSize: 12, seedBox: '14px', seedSize: '0.5rem',  showVsRow: true },
  dense:   { label: 'Dense',   groupGap: '0.625rem', cardGap: '0.25rem', headerPadY: '1px', playerPadY: '2px', nameSize: '0.8rem',  labelSize: '0.6rem',  flagSize: 11, seedBox: '13px', seedSize: '0.5rem',  showVsRow: false },
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
  hideNav = false,
  drawResultsMode = false,
  adminLockedMatches,
  pickLockTimes,
  matchDecidedAt,
  lockedPicks = [],
  initialRound,
  scopeRounds,
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
  /** Hides the entire internal nav bar — used when embedded in a page that already has navigation */
  hideNav?: boolean
  /** When true, shows draw results UI (no picks, just actual winners) */
  drawResultsMode?: boolean
  /** Admin-locked matches (manual_lock mode): matchId → ISO timestamp when locked */
  adminLockedMatches?: Record<string, string>
  /** Match IDs that were admin-locked when the user made their pick (no points) */
  lockedPicks?: string[]
  /** matchId → ISO time the pick was committed (predictions.pick_lock_times). */
  pickLockTimes?: Record<string, string>
  /**
   * matchId → ISO time the match stopped being an honest unknown: the earlier
   * of its result being entered and the organiser freezing it. Collapsed
   * server-side, and fed to `calculateStreakMultiplier` as its `playedAt`
   * argument so the preview runs the scorer's own rule rather than a copy.
   */
  matchDecidedAt?: Record<string, string>
  /**
   * Which round to open on, from `?round=` — the campaign links in the social
   * studio carry the round their post is about.
   *
   * Ignored unless the draw actually has that round, so a stale or hand-edited
   * link degrades to the first round rather than to an empty tab. Read once, as
   * the initial value only: the round is state from then on, and re-syncing it
   * would yank the tab back every time the URL changed under a soft navigation.
   */
  initialRound?: string
  /**
   * Restrict the bracket to these rounds — a scoped challenge, played from the
   * quarterfinals rather than over all 127 matches. Undefined is the whole draw
   * and the only thing a global prediction ever passes.
   *
   * Only the round STRIP is narrowed. Every lookup that walks `draw.matches` —
   * the feed map, `getEffectivePlayer`, the reverse map — deliberately keeps
   * the full draw: an in-scope round gets its players from the results of the
   * round before it, which is out of scope but very much still needed.
   */
  scopeRounds?: string[]
}) {
  // ── State ────────────────────────────────────────────────────────────────
  const [picks, setPicks] = useState<Record<string, string>>(existingPicks)
  const [currentPickLocks, setCurrentPickLocks] = useState<Record<string, string>>(pickLocks)
  const [fullyLocked, setFullyLocked] = useState(isFullyLocked)
  const [currentPredictionId, setCurrentPredictionId] = useState<string | null>(predictionId)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [slotError, setSlotError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showImport, setShowImport] = useState(true)
  const [h2hPlayers, setH2HPlayers] = useState<{ player1: Player; player2: Player } | null>(null)
  const [statsPlayers, setStatsPlayers] = useState<{ player1: Player; player2: Player } | null>(null)
  // Null means "follow the per-round default". Session-only on purpose:
  // persisting it would mean a new non-essential client-side store to gate on
  // `canStore` and document in /privacy, which is a lot of ceremony for a view
  // preference.
  const [densityOverride, setDensityOverride] = useState<Density | null>(null)
  const [showMinimap, setShowMinimap] = useState(false)
  /** null = the whole draw. See the `scopeRounds` prop. */
  const scopeSet = scopeRounds && scopeRounds.length > 0 ? new Set(scopeRounds) : null

  const [activeRound, setActiveRound] = useState(() => {
    const sorted = draw.rounds
      .slice()
      .sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
      .filter(r => !scopeSet || scopeSet.has(r))
    if (initialRound && sorted.includes(initialRound)) return initialRound
    return sorted[0] ?? 'QF'
  })

  const sortedRounds = draw.rounds
    .slice()
    .sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
    .filter(r => !scopeSet || scopeSet.has(r))

  // Full draw on purpose — feed-in for the first in-scope round comes from the
  // round before it.
  const feedMap = buildFeedMap(draw.matches)
  const byeMatchIds = new Set(draw.matches.filter(isByeMatch).map(m => m.matchId))

  /** Contested matches this bracket is responsible for. */
  const scopedMatches = draw.matches.filter(
    m => (!scopeSet || scopeSet.has(m.round)) && !byeMatchIds.has(m.matchId),
  )
  const scopedMatchIds = new Set(scopedMatches.map(m => m.matchId))
  const totalMatches = scopedMatches.length
  const pickedCount = Object.keys(picks).filter(id => scopedMatchIds.has(id)).length
  const challengeId = challengeContext?.challengeId ?? null

  // ── Bracket navigation ─────────────────────────────────────────────────
  // Reverse map: nextMatchId → [feeder matchId, ...]
  const reverseMap: Record<string, string[]> = {}
  for (const [matchId, entry] of Object.entries(feedMap)) {
    if (!reverseMap[entry.nextMatchId]) reverseMap[entry.nextMatchId] = []
    reverseMap[entry.nextMatchId].push(matchId)
  }

  const pendingScrollTarget = useRef<string | null>(null)
  const matchContainerRef = useRef<HTMLDivElement>(null)

  // After round changes, scroll to pending target match
  useEffect(() => {
    if (!pendingScrollTarget.current) return
    const target = pendingScrollTarget.current
    pendingScrollTarget.current = null

    requestAnimationFrame(() => {
      const el = matchContainerRef.current?.querySelector(
        `[data-match-id="${target}"]`
      ) as HTMLElement | null
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
  }, [activeRound])

  /** Navigate forward: go to next round, scroll to the target match */
  const navigateForward = useCallback((nextMatchId: string) => {
    const nextMatch = draw.matches.find(m => m.matchId === nextMatchId)
    if (!nextMatch) return
    pendingScrollTarget.current = nextMatchId
    setActiveRound(nextMatch.round)
  }, [draw.matches])

  /** Navigate backward: go to previous round, scroll to feeder matches */
  const navigateBackward = useCallback((matchId: string) => {
    const feeders = reverseMap[matchId]
    if (!feeders?.length) return
    const feederMatch = draw.matches.find(m => m.matchId === feeders[0])
    if (!feederMatch) return
    pendingScrollTarget.current = feeders[0]
    setActiveRound(feederMatch.round)
  }, [draw.matches, reverseMap])

  // Swipe navigation callbacks
  const handleSwipeLeft = useCallback(() => {
    const idx = sortedRounds.indexOf(activeRound)
    if (idx < sortedRounds.length - 1) setActiveRound(sortedRounds[idx + 1])
  }, [activeRound, sortedRounds])

  const handleSwipeRight = useCallback(() => {
    const idx = sortedRounds.indexOf(activeRound)
    if (idx > 0) setActiveRound(sortedRounds[idx - 1])
  }, [activeRound, sortedRounds])

  const swipeRef = useSwipeNavigation({
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
  })

  // ── Per-match lock state ─────────────────────────────────────────────────
  /** Check if a match is locked (result, voluntary, full lock — NOT admin lock, which is now pickable) */
  function isMatchLocked(matchId: string): boolean {
    if (readOnly || fullyLocked) return true
    if (matchResults?.[matchId]) return true           // Match has been played
    if (currentPickLocks[matchId]) return true          // Voluntarily locked
    return false
  }

  /**
   * Picks this user made AFTER the admin locked the match — the server's
   * `predictions.locked_picks`. These are the ones that score nothing.
   *
   * The distinction matters because an admin lock is a fact about the MATCH
   * while "will this score" is a fact about THIS USER'S PICK on it.
   * `savePrediction` keeps a pick out of `locked_picks` when it predates the
   * lock and has not changed since, so a timely picker is paid normally.
   */
  const latePickIds = useMemo(() => new Set(lockedPicks), [lockedPicks])

  /**
   * What this pick would be worth, as a multiplier, if it comes in.
   *
   * Runs `calculateStreakMultiplier` — the function award-points itself calls —
   * rather than restating its rules here, so the badge cannot drift from what
   * the cron will actually pay. The winner it asks about is your own pick: the
   * question on the page is "if I'm right, what does this pay".
   *
   * The question it answers is "if you lock your picks now, what is this worth" —
   * NOT "if you lock this one pick alone". Every pick on the board that could
   * still be committed is treated as committed now, because that is what the
   * page's primary button does, and what locking rounds in order does too.
   *
   * Scoping it to the single pick was wrong, and visibly so: a streak needs
   * every feeder in the chain committed, so a quarterfinal pick sitting on a
   * freshly made — and therefore uncommitted — round-of-16 pick read ×1, when
   * one press of "Lock all picks" commits both and makes it ×3. The number has
   * to describe the action the user is about to take.
   *
   * A pick on a match that has already been played is deliberately NOT treated
   * as committable: the cron stamps those 'auto', which is a record and never a
   * commitment, so counting one would promise a multiplier that cannot arrive.
   *
   * An already-committed pick keeps its real lock time, so for those this is
   * not a preview at all — it is the answer. Everything else decays on its own:
   * once a round below resolves, committing now stops earning that link and the
   * badge falls without anything having to invalidate it.
   */
  function previewMultiplier(matchId: string): number {
    const pickedId = picks[matchId]
    if (!pickedId || byeMatchIds.has(matchId)) return 1
    if (latePickIds.has(matchId)) return 1   // scores nothing at all

    const committed = committedPicks(currentPickLocks)
    const lockTimes = { ...(pickLockTimes ?? {}) }
    const now = new Date().toISOString()
    for (const m of Object.keys(picks)) {
      if (committed.has(m)) continue        // keeps its real, earlier time
      if (matchResults?.[m]) continue       // played: it will be 'auto', not a commitment
      committed.add(m)
      lockTimes[m] = now
    }

    // matchDecidedAt is already the earlier of the two boundaries, so it goes
    // in as `playedAt` and the admin argument is left off — earliest(a,
    // undefined) is a, which is exactly the collapsed value.
    return calculateStreakMultiplier(
      // This file types a match's `round` as a plain string (the draw is server
      // data), while the scorer narrows it to the Round union. Same objects,
      // and the multiplier never reads `round` — it walks the feed map.
      matchId, pickedId, picks, feedMap, draw.matches as unknown as LibDrawMatch[],
      latePickIds, committed, lockTimes, matchDecidedAt, undefined,
    )
  }

  /** Display state for the match header badge */
  type LockDisplay = 'editable' | 'voluntary_locked' | 'auto_locked' | 'admin_locked_pickable' | 'admin_locked_secured' | 'fully_locked' | 'bye'
  function getMatchLockDisplay(matchId: string): LockDisplay {
    if (byeMatchIds.has(matchId)) return 'bye'
    if (readOnly || fullyLocked) return 'fully_locked'
    if (matchResults?.[matchId]) return 'auto_locked'
    if (adminLockedMatches?.[matchId]) {
      // Telling somebody who picked in time that they get no points is simply
      // wrong — they are paid in full. But the warning cannot just disappear:
      // the match is still editable, and CHANGING the pick now moves it into
      // locked_picks and forfeits it. So the timely case gets its own badge
      // that says which of those two things is true.
      const pickedInTime = Boolean(picks[matchId]) && !latePickIds.has(matchId)
      return pickedInTime ? 'admin_locked_secured' : 'admin_locked_pickable'
    }
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
   * Players who have actually lost, from the real results chain alone.
   *
   * A pick can only score if the player it names actually reaches that match,
   * so anyone already beaten is a dead pick in every remaining round — which
   * is what makes a bracket quietly stop being able to score while still
   * looking full. The loser of a played match is definitionally the
   * participant who is not the winner, resolved from the draw in round one and
   * from real winners after that. Never from the user's picks: this has to be
   * reality, not their bracket.
   */
  const eliminatedPlayers = new Set<string>()
  {
    const realWinner: Record<string, string | undefined> = {}
    for (const round of sortedRounds) {
      for (const m of draw.matches) {
        if (m.round !== round) continue

        if (byeMatchIds.has(m.matchId)) {
          realWinner[m.matchId] = m.player1?.externalId ?? m.player2?.externalId
          continue
        }

        const winner = matchResults?.[m.matchId]
        if (!winner) continue
        realWinner[m.matchId] = winner

        const feeders = reverseFeedMap[m.matchId]
        const p1 = m.player1?.externalId
          ?? (feeders?.player1Feeder ? realWinner[feeders.player1Feeder] : undefined)
        const p2 = m.player2?.externalId
          ?? (feeders?.player2Feeder ? realWinner[feeders.player2Feeder] : undefined)

        // Skip rather than guess when a side is unresolved: an unrecorded
        // feeder result would otherwise eliminate whoever failed to resolve.
        if (p1 && p2) eliminatedPlayers.add(p1 === winner ? p2 : p1)
      }
    }
  }

  /**
   * Pick state for every match in the draw, for the minimap.
   *
   * Built as one forward pass over the rounds, so each match reads the already
   * -resolved winners of its two feeders. Resolving each match independently
   * would re-walk the tree from that match back to round one — 127 times over
   * a full draw. This is a single O(n) sweep instead.
   */
  const minimapState: Record<string, MinimapState> = {}
  {
    // matchId → who goes through: the actual result if played, else the pick.
    const advancing: Record<string, string | undefined> = {}
    for (const round of sortedRounds) {
      for (const m of draw.matches) {
        if (m.round !== round) continue

        if (byeMatchIds.has(m.matchId)) {
          minimapState[m.matchId] = 'bye'
          advancing[m.matchId] = m.player1?.externalId ?? m.player2?.externalId
          continue
        }

        const feeders = reverseFeedMap[m.matchId]
        const p1 = m.player1?.externalId
          ?? (feeders?.player1Feeder ? advancing[feeders.player1Feeder] : undefined)
        const p2 = m.player2?.externalId
          ?? (feeders?.player2Feeder ? advancing[feeders.player2Feeder] : undefined)

        const result = matchResults?.[m.matchId]
        const pick = picks[m.matchId]
        advancing[m.matchId] = result ?? pick

        if (!pick) { minimapState[m.matchId] = 'empty'; continue }
        if (result) { minimapState[m.matchId] = result === pick ? 'correct' : 'wrong'; continue }
        // Dead either because the player is already out of the tournament, or
        // because both sides of this match are known and the pick is neither.
        // The first case is what carries the news forward into rounds whose
        // players are still TBD.
        const dead = eliminatedPlayers.has(pick) || (!!p1 && !!p2 && pick !== p1 && pick !== p2)
        minimapState[m.matchId] = dead ? 'void' : 'picked'
      }
    }
  }

  const presentStates = new Set<MinimapState>(Object.values(minimapState))

  /**
   * `data-match-id` is written on the group wrapper, not on each card, and the
   * group is keyed by whichever of the pair feeds the player1 slot. Jumping to
   * the sibling would query for an id that is not in the DOM and silently not
   * scroll at all, so resolve to the group's leader first.
   */
  const groupLeaderFor = (matchId: string): string => {
    const feed = feedMap[matchId]
    if (!feed) return matchId
    const siblings = reverseMap[feed.nextMatchId] ?? []
    return siblings.find(id => feedMap[id]?.slot === 'player1') ?? matchId
  }

  const jumpToMatch = (matchId: string, round: string) => {
    const target = groupLeaderFor(matchId)
    if (round === activeRound) {
      matchContainerRef.current
        ?.querySelector(`[data-match-id="${target}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    pendingScrollTarget.current = target
    setActiveRound(round)
  }

  /**
   * Where a player in a slot came from.
   *
   * `settled` covers the draw itself, a BYE auto-advance and a played feeder —
   * three different mechanisms, but the same fact for a reader: this name is
   * not going to change. `projected` is the one that can: the slot is filled
   * from the user's own pick on a feeder that has not been played, so the
   * player is there on their say-so and nothing else.
   */
  type SlotOrigin = 'settled' | 'projected'

  /**
   * Resolve who is in a match slot, and on what authority.
   * Priority: 1) draw data  2) actual result from feeder  3) user pick from feeder  4) null (TBD)
   */
  function resolveSlot(
    match: DrawMatch,
    slot: 'player1' | 'player2',
    /**
     * Which pick set to resolve against. Defaults to the live state; pickWinner
     * passes a hypothetical one to ask "who WOULD be here if I made this
     * change" without touching state to find out.
     */
    source: Record<string, string> = picks,
  ): { player: Player | null; origin: SlotOrigin | null } {
    const settled = (player: Player | null) => ({ player, origin: (player ? 'settled' : null) as SlotOrigin | null })

    // 1. Draw data has the player directly (first round, or seeded bye)
    const base = match[slot]
    if (base) return settled(base)

    // Find the feeder match for this slot
    const feederMatchId = slot === 'player1'
      ? reverseFeedMap[match.matchId]?.player1Feeder
      : reverseFeedMap[match.matchId]?.player2Feeder

    if (!feederMatchId) return { player: null, origin: null }
    const feederMatch = draw.matches.find(m => m.matchId === feederMatchId)
    if (!feederMatch) return { player: null, origin: null }

    // BYE auto-advance: the non-null player wins automatically
    if (isByeMatch(feederMatch)) {
      return settled(feederMatch.player1 ?? feederMatch.player2)
    }

    // 2. Actual result from feeder match → real winner advances
    const feederWinnerId = matchResults?.[feederMatchId]
    if (feederWinnerId) {
      return settled(allPlayers.get(feederWinnerId) ?? { externalId: feederWinnerId, name: feederWinnerId, country: '' })
    }

    // 3. User's pick from feeder match
    const pickedId = source[feederMatchId]
    if (!pickedId) {
      // 3b. If feeder is admin-locked and has a result, show actual winner (cascade for missed picks)
      if (adminLockedMatches?.[feederMatchId] && feederWinnerId) {
        return settled(allPlayers.get(feederWinnerId) ?? { externalId: feederWinnerId, name: feederWinnerId, country: '' })
      }
      return { player: null, origin: null }
    }

    // Everything below is reached only because the user picked someone into
    // this slot, so the origin is `projected` however deep the resolution goes.
    // A projected player may themselves have been resolved from real results
    // further back — irrelevant here: what is unconfirmed is THIS advance.
    const projected = (player: Player | null) => ({ player, origin: (player ? 'projected' : null) as SlotOrigin | null })

    // Resolve the picked player — might be directly on the feeder or recursively resolved
    if (feederMatch.player1?.externalId === pickedId) return projected(feederMatch.player1)
    if (feederMatch.player2?.externalId === pickedId) return projected(feederMatch.player2)

    const p1 = resolveSlot(feederMatch, 'player1', source).player
    const p2 = resolveSlot(feederMatch, 'player2', source).player
    if (p1?.externalId === pickedId) return projected(p1)
    if (p2?.externalId === pickedId) return projected(p2)

    return { player: null, origin: null }
  }

  /**
   * Thin wrapper — every existing caller wants the player and nothing else.
   * Kept so the traversal above stays the single implementation rather than
   * being duplicated by a parallel "where did this come from" function that
   * could drift out of step with it.
   */
  function getEffectivePlayer(
    match: DrawMatch,
    slot: 'player1' | 'player2',
    source?: Record<string, string>,
  ): Player | null {
    return resolveSlot(match, slot, source).player
  }

  const pickWinner = (matchId: string, playerExternalId: string) =>
    applyPickChange(matchId, { ...picks, [matchId]: playerExternalId })

  /**
   * Remove a pick entirely, leaving the match unpicked.
   *
   * Switching to the other player was always possible; taking the pick back was
   * not, so a match touched by accident stayed answered. It runs through the
   * same guard and the same cascade as a change, because that is exactly what
   * it is — the downstream slot it fed now resolves to nobody, and any pick
   * standing on it has to go with it.
   *
   * Refused once the pick is committed: locking is one-way, and clearing would
   * be the unlock that migration 102 deliberately took away.
   */
  const clearPick = (matchId: string) => {
    if (currentPickLocks[matchId]) return
    const next = { ...picks }
    delete next[matchId]
    applyPickChange(matchId, next)
  }

  const applyPickChange = (matchId: string, newPicks: Record<string, string>) => {
    if (isMatchLocked(matchId)) return
    if (byeMatchIds.has(matchId)) return  // BYE matches are auto-resolved

    /**
     * Would this change strand a pick the user can no longer clear?
     *
     * The cascade below deletes downstream picks the change invalidates, but it
     * cannot touch a locked one — that is what locking means. Silently leaving
     * it behind produced brackets that contradict themselves: a committed pick
     * on a player their own earlier picks no longer send through, and every
     * slot after it unresolvable, drawn as TBD with nothing saying why.
     *
     * So the change is refused instead. The commitment is the fixed point — and
     * since the user-facing unlock was withdrawn, it is a permanent one: there
     * is no longer a door out of this refusal from inside the app, only an
     * admin unlock on request. Worth knowing before making the refusal any
     * broader than it already is.
     */
    const strandedLock = (mId: string, working: Record<string, string>): DrawMatch | null => {
      const feed = feedMap[mId]
      if (!feed) return null
      const nextMatch = draw.matches.find(m => m.matchId === feed.nextMatchId)
      if (!nextMatch) return null
      if (matchResults?.[nextMatch.matchId]) return null
      const nextPick = working[nextMatch.matchId]
      if (!nextPick) return null

      const validAfter = [
        getEffectivePlayer(nextMatch, 'player1', working)?.externalId,
        getEffectivePlayer(nextMatch, 'player2', working)?.externalId,
      ].filter(Boolean)
      if (validAfter.includes(nextPick)) return null

      // Only refuse a change that BREAKS something currently intact. Four
      // brackets already hold stranded locked picks from before this guard
      // existed; blocking every edit on them would trap their owners in a state
      // they cannot fix, which is worse than the incoherence itself.
      const validBefore = [
        getEffectivePlayer(nextMatch, 'player1', picks)?.externalId,
        getEffectivePlayer(nextMatch, 'player2', picks)?.externalId,
      ].filter(Boolean)
      const wasAlreadyStranded = !validBefore.includes(nextPick)

      if (currentPickLocks[nextMatch.matchId]) return wasAlreadyStranded ? null : nextMatch
      return strandedLock(nextMatch.matchId, working)
    }

    const blocked = strandedLock(matchId, newPicks)
    if (blocked) {
      setSlotError(
        `That change would leave your committed ${ROUND_LABELS[blocked.round] ?? blocked.round} pick ` +
        `stranded — the player you locked there would no longer reach that match. ` +
        `Unlock it first if you want to change this.`
      )
      return
    }
    setSlotError(null)

    const clearDownstream = (mId: string) => {
      const feed = feedMap[mId]
      if (!feed) return
      const nextMatch = draw.matches.find(m => m.matchId === feed.nextMatchId)
      if (!nextMatch) return
      // A played or locked match is fixed — the guard above has already refused
      // any change that would strand a locked pick, so reaching one here means
      // it stays valid.
      if (matchResults?.[nextMatch.matchId] || currentPickLocks[nextMatch.matchId]) return
      const nextPick = newPicks[nextMatch.matchId]
      if (nextPick) {
        // Against `newPicks`, not the component's `picks`: this walk is
        // deciding what the bracket looks like AFTER the change, and a cleared
        // feeder still resolves to its old player under the stale map — which
        // would leave every downstream pick standing on someone who is no
        // longer sent through.
        const p1 = getEffectivePlayer(nextMatch, 'player1', newPicks)
        const p2 = getEffectivePlayer(nextMatch, 'player2', newPicks)
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

  /**
   * Slots a lock would leave open — and that now stay open.
   *
   * This used to be the forfeit count, and it was the most important warning on
   * the page: locking took every unpicked slot away for good, so a bracket
   * locked at the quarters could never score the semis or the final. "Lock all
   * picks" now commits only the picks that were made, so there is nothing to
   * forfeit and nothing to warn about — the same number is still worth showing,
   * but as what remains to do rather than what was just lost.
   *
   * Counted the way the server counts it (savePrediction's `outstanding`): byes
   * are not picks anyone is asked to make, and a played match is not one they
   * can still make. The two must agree, or the copy promises a slot the save
   * has already closed.
   */
  const unpickedOpenMatches = scopedMatches.filter(m =>
    !matchResults?.[m.matchId] && !picks[m.matchId],
  ).length

  /** Rounds with no pick at all — named in the note, since "9 matches" is vaguer than "the semis". */
  const forfeitedRounds = findForfeitedRounds(
    toGapMatches(scopedMatches),
    new Set(Object.keys(matchResults ?? {})),
    new Set(Object.keys(picks).filter(id => picks[id])),
  )

  /** Lock entire bracket (replaces old "Submit & lock") */
  const handleLockAll = async () => {
    if (readOnly || fullyLocked) return

    // What is left open, said before the click rather than discovered after it.
    // This used to be a forfeit warning, because locking took those slots away
    // for good. It no longer does, so the sentence is now reassurance instead
    // of a threat — and it is the difference between a new user losing a
    // tournament and simply carrying on.
    const openNote = unpickedOpenMatches > 0
      ? `\n\n${unpickedOpenMatches} match${unpickedOpenMatches === 1 ? '' : 'es'} still ${unpickedOpenMatches === 1 ? 'has' : 'have'} no pick. ` +
        `Locking leaves ${unpickedOpenMatches === 1 ? 'it' : 'them'} open — you can still pick ${unpickedOpenMatches === 1 ? 'it' : 'them'} later.`
      : ''
    if (!confirm(
      `Lock ${pickedCount} pick${pickedCount === 1 ? '' : 's'}? They become final and start earning the streak multiplier. ` +
      `This cannot be undone.${openNote}`,
    )) return

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
        // Only the server knows whether that closed the bracket — a partial
        // one stays open, and flipping to the locked view here would hide the
        // very slots the change exists to keep reachable.
        setFullyLocked(result.fullyLocked === true)
        setCurrentPickLocks(prev => {
          const next = { ...prev }
          for (const matchId of Object.keys(picks)) {
            if (picks[matchId] && !next[matchId]) next[matchId] = 'auto_lock_all'
          }
          return next
        })
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

  /**
   * Share the bracket — as a picture where the platform allows one.
   *
   * "Share picks" used to copy a URL and stop. On a phone that is a link with
   * no image, and Instagram will not take a link at all: Stories sharing runs
   * on Android implicit intents and iOS custom URL schemes behind a Facebook
   * App ID, none of which exist in a browser. What a browser *can* do is hand
   * the OS share sheet a file, and Instagram is a target in it.
   *
   * So: fetch the rendered story card, share the file, and let the user pick
   * Instagram — one tap more than a native app would need. The caption cannot
   * ride along (Instagram drops shared text), which is why the invitation and
   * the URL are painted into the image itself.
   *
   * Desktop, and any browser without file sharing, gets the old behaviour.
   */
  const handleShare = async () => {
    if (!shareUrl || sharing) return
    const link = `${window.location.origin}${shareUrl}`

    const copyLink = () => {
      navigator.clipboard.writeText(link).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }

    // navigator.share must be called from the click that started it. An await
    // before the check is fine; an await before share() is not on iOS, so the
    // file is fetched first and share() is the next thing that happens.
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
      copyLink()
      return
    }

    setSharing(true)
    try {
      const res = await fetch(`${shareUrl}/story`)
      if (!res.ok) { copyLink(); return }
      const blob = await res.blob()
      const file = new File([blob], `${username || 'bracket'}-${tournament.id}.png`, { type: 'image/png' })

      if (!navigator.canShare({ files: [file] })) { copyLink(); return }

      await navigator.share({
        files: [file],
        // Carried where the target accepts it. Instagram will not, which is why
        // the same words are on the card.
        text: `Check my ${tournament.name} predictions and challenge me — ${link}`,
      })
    } catch (e) {
      // AbortError is the user closing the sheet; anything else falls back to
      // the behaviour this button has always had rather than dead-ending.
      if ((e as Error)?.name !== 'AbortError') copyLink()
    } finally {
      setSharing(false)
    }
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

  /**
   * Commit every changeable pick in one round, leaving the rest of the bracket open.
   *
   * The middle ground the bracket never had. "Lock pick" binds one match and buys
   * nothing; "Lock all picks" buys the multiplier on everything but ends the
   * bracket, forfeiting every round still to open. This commits exactly what is
   * in front of you and keeps the rest editable.
   */
  const handleLockRound = async (round: string) => {
    if (readOnly || fullyLocked) return
    const { committable, empty } = getRoundLockState(round)
    if (committable === 0) return

    const label = ROUND_PROSE[round] ?? 'this round'
    const emptyNote = empty > 0
      ? `\n\n${empty} match${empty === 1 ? '' : 'es'} in this round ${empty === 1 ? 'has' : 'have'} no pick. Locking leaves ${empty === 1 ? 'it' : 'them'} open — you can still pick ${empty === 1 ? 'it' : 'them'} later.`
      : ''
    if (!confirm(
      `Lock ${label}? Those ${committable} pick${committable === 1 ? '' : 's'} become final and start earning the streak multiplier. ` +
      `The rest of your bracket stays editable.${emptyNote}`,
    )) return

    setSaving(true)
    setSlotError(null)
    try {
      const result = await savePrediction({
        tournamentId: tournament.id,
        picks,
        predictionId: currentPredictionId,
        challengeId,
        lockRound: round,
      })
      if (result.success) {
        setCurrentPickLocks(prev => {
          const next = { ...prev }
          for (const m of matchesForRound(round)) {
            if (byeMatchIds.has(m.matchId)) continue
            if (matchResults?.[m.matchId] || next[m.matchId] || !picks[m.matchId]) continue
            next[m.matchId] = 'round'
          }
          return next
        })
        setSaved(true)
        if (result.predictionId) setCurrentPredictionId(result.predictionId)
      } else {
        console.error('Lock round failed')
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

  /**
   * What committing this round would do, and whether it can be done at all.
   *
   * `committable` counts the picks that are still changeable — those are what a
   * round lock would actually commit. `empty` counts the slots with no pick that
   * have not been played: locking does not touch them (the server skips them),
   * so unlike "Lock all picks" a round lock forfeits nothing, and the copy can
   * say so honestly.
   */
  function getRoundLockState(round: string): { committable: number; locked: number; empty: number; total: number } {
    let committable = 0, locked = 0, empty = 0, total = 0
    for (const m of matchesForRound(round)) {
      if (byeMatchIds.has(m.matchId)) continue
      total++
      if (matchResults?.[m.matchId]) continue          // decided — nothing to commit
      if (currentPickLocks[m.matchId]) { locked++; continue }
      if (picks[m.matchId]) committable++
      else empty++
    }
    return { committable, locked, empty, total }
  }

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

  // Declared here, not up with the other derived values: getRoundLockState closes
  // over `matchesForRound`, which is a const defined just above. Reading it from
  // the top of the component compiles fine and throws at runtime.
  const activeRoundLock = getRoundLockState(activeRound)

  // Count correctly picked vs total played (for read-only summary), excluding BYE matches
  const correctPicks = readOnly && matchResults
    ? Object.entries(picks).filter(([matchId, playerId]) => scopedMatchIds.has(matchId) && matchResults[matchId] === playerId).length
    : null
  const totalResultsExcludingByes = matchResults
    ? Object.keys(matchResults).filter(matchId => scopedMatchIds.has(matchId)).length
    : 0

  // Check if we're in challenge mode with empty picks (for import prompt)
  // Only show import banner on first visit (no prediction saved yet) with no picks
  const showImportBanner = !!challengeContext && pickedCount === 0 && !fullyLocked && !readOnly && showImport && !currentPredictionId

  // ── Determine what the editable state really is ──────────────────────────
  const isEditing = !readOnly && !fullyLocked

  // Derived, not synced: an effect writing state on `activeRound` change is
  // exactly the pattern `react-hooks/set-state-in-effect` exists to catch.
  const density = densityOverride ?? defaultDensityForRound(activeRound)
  const d = DENSITY[density]

  const hasResults = !!matchResults && Object.keys(matchResults).length > 0

  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>

      {/* Sticky top block — nav + banners + round tabs */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>

      {/* Nav */}
      {!hideNav && (
      <nav className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        {/*
          Wraps and drops the wordmark below `sm:`. The wordmark plus back link,
          pick counter, "Save draft" and "Lock all picks" came to 383px against
          375px, so the primary action on the page was clipped at the right
          edge. The wordmark is the one element here that is pure decoration —
          this is a focused task screen reached from elsewhere in the app — so
          it yields first, and the actions wrap rather than overflow.
        */}
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 py-4">
          {/* Logo */}
          <Link href="/dashboard" className="hidden sm:block" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
            Quiet Please
          </Link>

          <div className="flex flex-wrap items-center gap-2 sm:ml-4">
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
              {drawResultsMode
                ? `${totalResultsExcludingByes}/${totalMatches} played`
                : readOnly
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
                <Tooltip text="Commit every pick you have made so far. They start earning the streak multiplier and can never be changed again. Matches you have not picked stay open.">
                  <button
                    onClick={handleLockAll}
                    disabled={saving || pickedCount === 0}
                    className="px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
                    style={{ background: 'var(--court)', color: 'white', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    {saving ? 'Saving…' : (
                      <>
                        Lock all picks
                        <InfoIcon />
                      </>
                    )}
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </nav>
      )}


      {/* Round tabs */}
      <div className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        {/*
          Wraps rather than scrolls. Seven rounds plus their progress badges do
          not fit 375px on any reasonable label set, and as a scroller the later
          rounds — including the Final — were simply off screen with nothing to
          indicate it. Short labels get the read-only case onto one row; the
          predict view, which adds a "3/8" badge per tab, takes a second row
          instead of hiding half the tournament.
        */}
        <div className="max-w-5xl mx-auto flex flex-wrap items-center">
          {sortedRounds.map(round => {
            const stats = getRoundStats(round)
            const allDone = stats.done === stats.total && stats.total > 0
            return (
              <button
                key={round}
                onClick={() => setActiveRound(round)}
                className="px-2.5 sm:px-5 py-3 text-xs whitespace-nowrap border-b-2 transition-colors flex-shrink-0 flex items-center gap-1.5"
                style={{
                  borderBottomColor: activeRound === round ? 'var(--court)' : 'transparent',
                  color: activeRound === round ? 'var(--court)' : 'var(--muted)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em',
                }}
              >
                <span className="sm:hidden">{SHORT_ROUND_LABELS[round] ?? round}</span>
                <span className="hidden sm:inline">{ROUND_LABELS[round] ?? round}</span>
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
                {/* A round with nothing left to commit reads as done at a glance,
                    which is the whole point of committing round by round. */}
                {!readOnly && !fullyLocked && getRoundLockState(round).locked > 0
                  && getRoundLockState(round).committable === 0 && (
                  <span aria-label="round locked" title="Locked — earning the streak multiplier" style={{ fontSize: '0.6rem' }}>🔒</span>
                )}
              </button>
            )
          })}

          {/*
            Zoom. `ml-auto` parks it at the right of the tab row on desktop and
            lets it drop to its own line at 375px rather than squeezing the
            round tabs, which are the more important control.
          */}
          {/*
            Padding is px-2 at every width, not sm:px-4. The tab row for a
            128-draw is 849px inside a 1024px container, which leaves ~175px —
            and the control at its widest wanted 177px.
          */}
          <div className="ml-auto flex items-center gap-1 px-2 py-2 flex-shrink-0">
            <button
              onClick={() => setShowMinimap(v => !v)}
              aria-pressed={showMinimap}
              title="Show the whole bracket at a glance"
              className="rounded-sm border transition-colors mr-1"
              style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.06em',
                padding: '0 6px', height: '24px', display: 'inline-flex', alignItems: 'center',
                borderColor: showMinimap ? 'var(--court)' : 'var(--chalk-dim)',
                color: showMinimap ? 'var(--court)' : 'var(--muted)',
                background: showMinimap ? '#eef4ff' : 'transparent',
              }}
            >
              MAP
            </button>
            {/*
              Fixed width, because the label is the widest thing in here and it
              changes when you press the button next to it. "COMPACT" is two
              characters longer than "DENSE" and "ROOMY" — about 13px — which
              was enough to push the whole control onto a second line only at
              that one zoom level, so it jumped lines as you clicked through.
            */}
            <span className="hidden sm:inline-block text-center" style={{ width: '52px', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
              {d.label}
            </span>
            {([['out', '−', 'Show more matches'], ['in', '+', 'Show fewer, larger matches']] as const).map(([dir, glyph, title]) => {
              const idx = DENSITY_ORDER.indexOf(density)
              const nextIdx = dir === 'out' ? idx - 1 : idx + 1
              const disabled = nextIdx < 0 || nextIdx >= DENSITY_ORDER.length
              return (
                <button
                  key={dir}
                  onClick={() => !disabled && setDensityOverride(DENSITY_ORDER[nextIdx])}
                  disabled={disabled}
                  aria-label={title}
                  title={title}
                  className="rounded-sm border transition-colors disabled:opacity-30 hover:bg-white"
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.85rem', lineHeight: 1,
                    width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'transparent',
                  }}
                >
                  {glyph}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/*
        Minimap: one row per round, one cell per match, each row filling the
        width. Cell width therefore doubles every round, which draws the funnel
        of the draw for free and keeps R128's 64 cells legible at 375px.

        Cells are ~5px wide in the first round — well under a comfortable touch
        target. That is tolerable here because the round tabs remain the primary
        navigation and a near miss still lands you in the right neighbourhood of
        the right round, which is all a minimap owes you.
      */}
      {showMinimap && (
        <div className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-2 flex flex-col" style={{ gap: '2px' }}>
            {sortedRounds.map(round => {
              const isActive = round === activeRound
              return (
                <div key={round} className="flex items-center" style={{ gap: '6px' }}>
                  <button
                    onClick={() => setActiveRound(round)}
                    className="flex-shrink-0 text-left"
                    style={{
                      width: '26px', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                      // Without this the label's default line-height, not the
                      // 7px cells, sets the row height — which cost the strip
                      // ~30px over seven rounds.
                      fontFamily: 'var(--font-mono)', fontSize: '0.5rem', lineHeight: 1, letterSpacing: '0.04em',
                      color: isActive ? 'var(--court)' : 'var(--muted)',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {SHORT_ROUND_LABELS[round] ?? round}
                  </button>
                  {/* Only a light dim on the other rounds. The strip's job is
                      the whole tournament at once, so burying six rounds to
                      spotlight one would defeat it — the green label already
                      says which round you are in. */}
                  <div className="flex flex-1" style={{ gap: '1px', opacity: isActive ? 1 : 0.8 }}>
                    {draw.matches.filter(m => m.round === round).map(m => (
                      <button
                        key={m.matchId}
                        onClick={() => jumpToMatch(m.matchId, round)}
                        aria-label={`${SHORT_ROUND_LABELS[round] ?? round} match — ${minimapState[m.matchId] ?? 'empty'}`}
                        title={`${SHORT_ROUND_LABELS[round] ?? round} · ${minimapState[m.matchId] ?? 'empty'}`}
                        style={{
                          flex: 1, height: '7px', minWidth: 0, padding: 0, border: 'none',
                          borderRadius: '1px', cursor: 'pointer',
                          background: MINIMAP_COLORS[minimapState[m.matchId] ?? 'empty'],
                        }}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            {/*
              Only the states this bracket actually contains. Six swatches is
              two wrapped lines at 375px and most of them are irrelevant to any
              given bracket — an untouched one is all "no pick" and "bye".
            */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ paddingTop: '5px' }}>
              {MINIMAP_LEGEND.filter(([state]) => presentStates.has(state)).map(([state, label]) => (
                <span
                  key={state}
                  className="inline-flex items-center gap-1"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.04em', color: 'var(--muted)' }}
                >
                  <span style={{ width: '7px', height: '7px', borderRadius: '1px', background: MINIMAP_COLORS[state], flexShrink: 0 }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      </div>{/* end sticky top block */}

      {/*
        Deliberately outside the sticky block. It is reference text that
        never changes, and at 375px it stood 91px tall — taller than the
        round tabs — so pinning it spent a fifth of the screen restating a
        colour key the reader has already read. Nav, tabs and the minimap
        stay pinned because they are navigation; this is not.
      */}
      {/*
        Banner for any bracket that can no longer be edited — someone else's
        picks, a completed tournament, or your own after "Lock all picks".
        It was gated on `readOnly` alone, so a stranger reading your bracket was
        told what the colours meant and you were not, on the same screen full of
        green, red and gold.
      */}
      {(readOnly || fullyLocked) && !hideNav && (
        <div style={{ background: '#f1efe8', borderBottom: '1px solid var(--chalk-dim)' }}>
          {/* First row: badge + (desktop legend) + share button */}
          <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 md:px-6 py-2.5">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', fontWeight: 600, flexShrink: 0 }}>
              {drawResultsMode ? 'DRAW RESULTS' : 'LOCKED PICKS'}
            </span>
            {/* Legend inline — desktop only */}
            <span className="hidden md:inline" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              {drawResultsMode
                ? 'Gold = match winner'
                : matchResults && Object.keys(matchResults).length > 0
                  ? 'Green = correct · Red = wrong · Gold = actual winner you missed'
                  : 'Results not yet available — check back after matches are played.'}
            </span>
            {shareUrl && (
              <button
                onClick={handleShare}
                disabled={sharing}
                className="ml-auto px-3 py-1 rounded-sm border text-xs transition-colors flex-shrink-0 disabled:opacity-40"
                style={{ borderColor: 'var(--chalk-dim)', color: copied ? 'var(--court)' : 'var(--muted)', background: 'white' }}
              >
                {sharing ? 'Preparing…' : copied ? 'Copied!' : 'Share picks'}
              </button>
            )}
          </div>
          {/* Legend below — mobile only */}
          <p className="max-w-5xl mx-auto md:hidden mt-1 px-4 md:px-6 pb-1" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            {drawResultsMode
              ? 'Gold = match winner'
              : matchResults && Object.keys(matchResults).length > 0
                ? 'Green = correct · Red = wrong · Gold = actual winner you missed'
                : 'Results not yet available — check back after matches are played.'}
          </p>
        </div>
      )}

      {/* Header */}
      {!hideNav && (
      <div className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-5">
        <div className="flex items-center gap-2 mb-1" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href={`/tournaments/${tournament.id}`} style={{ color: 'var(--muted)' }}>{tournament.flag_emoji ? `${tournament.flag_emoji} ` : ''}{tournament.location ? `${tournament.location} · ${tournament.name}` : tournament.name}</Link>
          <span>/</span>
          <span>
            {drawResultsMode
              ? 'Draw results'
              : readOnly
                ? `${username}'s picks`
                : challengeContext
                  ? `Challenge vs ${challengeContext.opponentUsername}`
                  : 'Your picks'}
          </span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
          {/* A locked bracket is a record, not a task. "Make your predictions"
              over a header reading 95/95 LOCKED ✓ describes something the
              reader cannot do. Challenges keep their own title, which stays
              accurate either way. */}
          {drawResultsMode
            ? 'Draw Results'
            : readOnly
              ? `${username}'s picks`
              : challengeContext
                ? `Challenge vs ${challengeContext.opponentUsername}`
                : fullyLocked
                  ? 'Your locked bracket'
                  : 'Make your predictions'}
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
          {drawResultsMode
            ? 'Actual match results round by round.'
            : readOnly
              ? `View ${username}'s picks round by round.`
            : fullyLocked
              ? (hasResults
                  ? 'Your picks are final. Follow how they are scoring, round by round.'
                  : 'Your picks are final. Check back once matches are played to see how they scored.')
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
      )}

      {/* Matches */}
      <div
        className="max-w-xl mx-auto px-4 md:px-6 py-6"
        ref={(el) => {
          matchContainerRef.current = el
          ;(swipeRef as React.MutableRefObject<HTMLDivElement | null>).current = el
        }}
      >

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

        <div className="flex flex-col" style={{ gap: d.groupGap }}>
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
                origin: SlotOrigin | null = null,
              ) => {
                const style = PICK_STYLES[state]
                const isBye = byeMatchIds.has(match.matchId)
                const matchLocked = isMatchLocked(match.matchId)
                const isClickable = !matchLocked && !!player && !isBye
                const isProjected = origin === 'projected'
                return (
                  <button
                    onClick={() => {
                      if (!player) return
                      // Click the player you already chose to take the pick back.
                      // Discoverable without hanging a control off all 127 rows,
                      // and it reads the way a selected option should behave.
                      if (picks[match.matchId] === player.externalId) clearPick(match.matchId)
                      else pickWinner(match.matchId, player.externalId)
                    }}
                    disabled={!player || matchLocked || isBye}
                    className={`pick-btn w-full flex items-center justify-between px-3 text-left${withBorderBottom ? ' border-b' : ''}`}
                    // Not colour/pattern alone: the same fact reaches a screen
                    // reader and a hover through the accessible name.
                    title={
                      isClickable && player && picks[match.matchId] === player.externalId
                        ? `Clear your pick on ${player.name}`
                        : isProjected && player
                          ? `${player.name} is here because you picked them to win their previous match — not confirmed yet.`
                          : undefined
                    }
                    style={{
                      paddingTop: d.playerPadY,
                      paddingBottom: d.playerPadY,
                      borderColor: 'var(--chalk-dim)',
                      // backgroundColor + backgroundImage rather than the
                      // `background` shorthand: the shorthand resets the other
                      // half, so the hatch and the outcome wash would fight
                      // over which one survives.
                      backgroundColor: style.bg,
                      backgroundImage: isProjected ? PROJECTED_HATCH : undefined,
                      cursor: isClickable ? 'pointer' : 'default',
                      opacity: !player ? 0.35 : 1,
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {player?.seed ? (
                        <Tooltip text="Tournament seed. Seeded players are the highest-ranked and placed in the draw to avoid early meetings.">
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: d.seedSize,
                            fontWeight: 600,
                            color: 'white',
                            background: '#5a5a4a',
                            minWidth: d.seedBox,
                            height: d.seedBox,
                            borderRadius: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            cursor: 'help',
                          }}>{player.seed}</span>
                        </Tooltip>
                      ) : (
                        <span style={{ minWidth: d.seedBox, flexShrink: 0 }} />
                      )}
                      <span className="truncate" style={{ fontFamily: 'var(--font-display)', fontSize: d.nameSize, letterSpacing: '-0.01em', color: player ? 'var(--ink)' : 'var(--muted)' }}>
                        {player?.name ?? (isBye ? 'BYE' : 'TBD')}
                      </span>
                      {player?.country && player.country.toLowerCase() !== 'world' && (
                        <CountryFlag country={player.country} size={d.flagSize} />
                      )}
                    </div>
                    {state !== 'none' && (() => {
                      const mp = state === 'correct' ? matchPoints?.[match.matchId] : undefined
                      const hasStreak = !!mp && mp.streakMultiplier > 1
                      const basePoints = mp ? (hasStreak ? Math.round(mp.points / mp.streakMultiplier) : mp.points) : 0
                      const labelText = mp
                        ? `✓ +${basePoints} pts${hasStreak ? ` ×${mp.streakMultiplier}` : ''}`
                        : style.label
                      const pill = (
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: d.labelSize,
                          color: style.labelColor,
                          background: style.labelBg,
                          padding: '2px 8px',
                          borderRadius: '2px',
                          flexShrink: 0,
                          marginLeft: '8px',
                          border: state === 'winner' ? '1px solid #fcd34d' : undefined,
                          display: 'inline-flex',
                          alignItems: 'center',
                          cursor: hasStreak ? 'help' : undefined,
                        }}>
                          {labelText}
                          {hasStreak && <InfoIcon />}
                        </span>
                      )
                      // Only wrap with tooltip when there's a streak multiplier — otherwise
                      // the tag is self-evident (correct / wrong / picked / winner / bye).
                      return hasStreak && mp ? (
                        <Tooltip
                          text={`Earned ${mp.points} pts: ${basePoints} base × ${mp.streakMultiplier}× streak bonus for picking this player through consecutive rounds.`}
                        >
                          {pill}
                        </Tooltip>
                      ) : pill
                    })()}
                  </button>
                )
              }

              const isFirstRound = sortedRounds.indexOf(activeRound) === 0
              const isLastRound = sortedRounds.indexOf(activeRound) === sortedRounds.length - 1
              const hasForward = !isLastRound && group.some(m => feedMap[m.matchId])
              const hasBackward = !isFirstRound && group.some(m => reverseMap[m.matchId]?.length)

              return (
                <div key={gi} className="flex items-stretch" data-match-id={group[0].matchId}>
                  {/* Left bracket connector — backward navigation */}
                  {hasBackward && (
                    <button
                      onClick={() => navigateBackward(group[0].matchId)}
                      className="bracket-nav-btn"
                      style={{
                        width: '48px', position: 'relative', flexShrink: 0, alignSelf: 'stretch',
                        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px',
                      }}
                      aria-label="Go to previous round"
                      title="View feeder matches"
                    >
                      {group.length === 2 ? (
                        <>
                          {/* Top feeder bracket: ⊃ shape merging two lines into one */}
                          <div style={{ position: 'absolute', top: '12.5%', bottom: 'calc(50% + 6px)', left: '4px', right: '8px' }}>
                            {/* Top horizontal stub */}
                            <div style={{ position: 'absolute', top: '0px', left: '0px', width: '40%', borderBottom: '1.5px solid var(--muted)' }} />
                            {/* Bottom horizontal stub */}
                            <div style={{ position: 'absolute', bottom: '0px', left: '0px', width: '40%', borderBottom: '1.5px solid var(--muted)' }} />
                            {/* Vertical connecting line */}
                            <div style={{ position: 'absolute', top: '0px', bottom: '0px', left: '40%', borderRight: '1.5px solid var(--muted)' }} />
                            {/* Horizontal line to match */}
                            <div style={{ position: 'absolute', top: '50%', left: '40%', right: '0px', borderBottom: '1.5px solid var(--muted)' }} />
                          </div>
                          {/* Bottom feeder bracket: ⊃ shape */}
                          <div style={{ position: 'absolute', top: 'calc(50% + 6px)', bottom: '12.5%', left: '4px', right: '8px' }}>
                            <div style={{ position: 'absolute', top: '0px', left: '0px', width: '40%', borderBottom: '1.5px solid var(--muted)' }} />
                            <div style={{ position: 'absolute', bottom: '0px', left: '0px', width: '40%', borderBottom: '1.5px solid var(--muted)' }} />
                            <div style={{ position: 'absolute', top: '0px', bottom: '0px', left: '40%', borderRight: '1.5px solid var(--muted)' }} />
                            <div style={{ position: 'absolute', top: '50%', left: '40%', right: '0px', borderBottom: '1.5px solid var(--muted)' }} />
                          </div>
                        </>
                      ) : (
                        /* Single match: ⊃ shape — two lines merging into one */
                        <div style={{ position: 'absolute', top: '25%', bottom: '25%', left: '4px', right: '8px' }}>
                          <div style={{ position: 'absolute', top: '0px', left: '0px', width: '40%', borderBottom: '1.5px solid var(--muted)' }} />
                          <div style={{ position: 'absolute', bottom: '0px', left: '0px', width: '40%', borderBottom: '1.5px solid var(--muted)' }} />
                          <div style={{ position: 'absolute', top: '0px', bottom: '0px', left: '40%', borderRight: '1.5px solid var(--muted)' }} />
                          <div style={{ position: 'absolute', top: '50%', left: '40%', right: '0px', borderBottom: '1.5px solid var(--muted)' }} />
                        </div>
                      )}
                    </button>
                  )}

                  {/* Match cards column */}
                  <div className="flex flex-col flex-1" style={{ gap: d.cardGap }}>
                    {group.map((match) => {
                      const i = matchIndex++
                      const isBye = byeMatchIds.has(match.matchId)
                      const slot1 = resolveSlot(match, 'player1')
                      const slot2 = resolveSlot(match, 'player2')
                      const p1 = slot1.player
                      const p2 = slot2.player
                      const o1 = slot1.origin
                      const o2 = slot2.origin
                      const pickedId = picks[match.matchId]
                      const actualWinnerId = matchResults?.[match.matchId]
                      const noPlayers = !p1 && !p2
                      const lockDisplay = getMatchLockDisplay(match.matchId)

                      // Void pick: the picked player can no longer win this match.
                      //
                      // The second clause is the original test — both sides
                      // known, pick is neither — which only fires once the
                      // match has real players. The first clause is what makes
                      // the death visible in later rounds too: a bracket whose
                      // QF pick is out used to show "TBD vs TBD · LOCKED" in the
                      // semifinal, with nothing to say the run was already over.
                      //
                      // `!actualWinnerId` is load-bearing. Every loser is in
                      // eliminatedPlayers, including the loser of THIS match,
                      // so without it a played match you simply got wrong
                      // reports "your pick was eliminated" instead of "wrong".
                      // A played match is scored, never void — the same
                      // ordering the minimap uses.
                      const voidPick = !isBye && !!pickedId && !actualWinnerId && (
                        eliminatedPlayers.has(pickedId)
                        || (!!p1 && !!p2 && pickedId !== p1.externalId && pickedId !== p2.externalId)
                      )
                      const voidPickPlayer = voidPick ? allPlayers.get(pickedId) : null

                      // BYE matches: non-null player gets 'bye' state, null side gets 'none'
                      const s1 = isBye ? (match.player1 ? 'bye' as const : 'none' as const) : getPickState(voidPick ? undefined : pickedId, p1?.externalId, actualWinnerId)
                      const s2 = isBye ? (match.player2 ? 'bye' as const : 'none' as const) : getPickState(voidPick ? undefined : pickedId, p2?.externalId, actualWinnerId)

                      // Show per-pick lock button? Only if: editable, has a valid (non-void) pick, not saving
                      const showLockBtn = lockDisplay === 'editable' && !!pickedId && !isBye && !voidPick

                      return (
                        <div key={match.matchId} className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: isBye ? '#bfdbfe' : 'var(--chalk-dim)' }}>
                          {/* Match header */}
                          <div className="px-3 border-b flex items-center justify-between" style={{ paddingTop: d.headerPadY, paddingBottom: d.headerPadY, borderColor: isBye ? '#bfdbfe' : 'var(--chalk-dim)', background: isBye ? '#eff6ff' : '#fafaf8' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: isBye ? '#1e40af' : 'var(--muted)', letterSpacing: '0.05em' }}>
                              MATCH {i + 1}{isBye ? ' · BYE' : ''}
                            </span>

                            {/* Void pick indicator */}
                            {voidPick && (
                              <Tooltip text="Your pick lost in an earlier round. You can still make picks for later rounds, but they won't score unless you change your upstream picks.">
                                <span style={{
                                  fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.04em',
                                  color: '#991b1b', background: '#fee2e2', padding: '1px 6px', borderRadius: '2px',
                                  display: 'inline-flex', alignItems: 'center', cursor: 'help',
                                }}>
                                  {voidPickPlayer?.name ?? 'Your pick'} eliminated
                                  <InfoIcon />
                                </span>
                              </Tooltip>
                            )}

{/* What this pick is worth, while it can still change. Shown only in
                                the editable state: once committed the LOCKED badge takes
                                this slot and the number is already settled. */}
                            {!voidPick && lockDisplay === 'editable' && !!pickedId && !isBye && (() => {
                              const mult = previewMultiplier(match.matchId)
                              const carries = mult > 1
                              return (
                                <Tooltip text={carries
                                  ? `Lock your picks now and this one scores ×${mult} — ${mult - 1} round${mult - 1 === 1 ? '' : 's'} below it ${mult - 1 === 1 ? 'is' : 'are'} still undecided, and you have backed this player through every one of them. Wait until ${mult - 1 === 1 ? 'it is' : 'they are'} played and the same pick pays ×1.`
                                  : 'Locking now would score this at ×1. The multiplier counts the rounds below a pick that are still undecided when you commit it, and everything under this one has already been decided — so this match is all that is still at stake.'}>
                                  <span style={{
                                    fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.04em',
                                    color: carries ? 'var(--court)' : 'var(--muted)',
                                    background: carries ? '#e4efe7' : 'transparent',
                                    padding: carries ? '1px 6px' : '1px 0',
                                    borderRadius: '2px',
                                    display: 'inline-flex', alignItems: 'center', cursor: 'help',
                                  }}>
                                    {carries ? `LOCKS AT ×${mult}` : 'LOCKS AT ×1'}
                                    <InfoIcon />
                                  </span>
                                </Tooltip>
                              )
                            })()}

                            {/* Lock status / hint — voluntary (user chose to lock THIS pick) → green */}
                            {!voidPick && lockDisplay === 'voluntary_locked' && (
                              <Tooltip text="You locked this pick yourself. It earns the streak multiplier and can't be changed anymore.">
                                <span style={{
                                  fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.05em',
                                  color: 'var(--court)', display: 'inline-flex', alignItems: 'center', cursor: 'help',
                                }}>
                                  LOCKED ✓
                                  <InfoIcon />
                                </span>
                              </Tooltip>
                            )}
                            {/* Fully locked — whole bracket is final (read-only or "Lock all picks") → gray */}
                            {!voidPick && lockDisplay === 'fully_locked' && (
                              <Tooltip text="This bracket is locked. Predictions are final — no more changes possible.">
                                <span style={{
                                  fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.05em',
                                  color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', cursor: 'help',
                                }}>
                                  LOCKED ✓
                                  <InfoIcon />
                                </span>
                              </Tooltip>
                            )}
                            {!voidPick && lockDisplay === 'auto_locked' && (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.05em', color: 'var(--muted)' }}>
                                PLAYED
                              </span>
                            )}
                            {!voidPick && lockDisplay === 'admin_locked_secured' && (
                              <Tooltip text="Your pick was in before the admin locked this match, so it scores as normal. Changing it now would forfeit the points.">
                                <span style={{
                                  fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.04em',
                                  color: '#166534', background: '#dcfce7', padding: '1px 6px', borderRadius: '2px',
                                  display: 'inline-flex', alignItems: 'center', cursor: 'help',
                                }}>
                                  PICKED IN TIME
                                  <InfoIcon />
                                </span>
                              </Tooltip>
                            )}
                            {!voidPick && lockDisplay === 'admin_locked_pickable' && (
                              <Tooltip text="You can still make a pick, but no points will be awarded — the admin locked this match after it started.">
                                <span style={{
                                  fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.04em',
                                  color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: '2px',
                                  display: 'inline-flex', alignItems: 'center', cursor: 'help',
                                }}>
                                  NO POINTS
                                  <InfoIcon />
                                </span>
                              </Tooltip>
                            )}
                            {!voidPick && showLockBtn && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleLockPick(match.matchId) }}
                                disabled={saving}
                                className="px-2 py-0.5 rounded-sm border transition-colors hover:border-gray-400 disabled:opacity-40"
                                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.04em', color: 'var(--muted)', borderColor: 'var(--chalk-dim)', background: 'white' }}
                              >
                                Lock pick
                              </button>
                            )}
                            {!voidPick && noPlayers && !readOnly && !isBye && lockDisplay === 'editable' && (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                                {activeRound === sortedRounds[0] ? 'Players not available yet' : 'Pick earlier rounds first'}
                              </span>
                            )}
                          </div>

                          {renderPlayer(match, p1, 'player1', s1, true, o1)}

                          {/* Dropped at `dense`: the strip is mostly the VS
                              label, and the divider under player 1 already
                              separates the two. STATS comes back a zoom step in. */}
                          {d.showVsRow && (
                          <div className="flex items-center justify-center gap-2" style={{ background: '#fafaf8', paddingTop: '4px', paddingBottom: '4px' }}>
                            {SHOW_H2H && p1 && p2 && !isBye && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setH2HPlayers({ player1: p1, player2: p2 }) }}
                                className="h2h-btn"
                                style={{
                                  fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.04em',
                                  color: 'var(--court)', background: 'white',
                                  border: '1px solid var(--chalk-dim)', borderRadius: '2px',
                                  padding: '2px 6px', lineHeight: 1, cursor: 'pointer',
                                }}
                              >
                                H2H
                              </button>
                            )}
                            {p1 && p2 && !isBye && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setStatsPlayers({ player1: p1, player2: p2 }) }}
                                className="h2h-btn"
                                title="Your record picking these players"
                                style={{
                                  fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.04em',
                                  color: 'var(--court)', background: 'white',
                                  border: '1px solid var(--chalk-dim)', borderRadius: '2px',
                                  padding: '2px 6px', lineHeight: 1, cursor: 'pointer',
                                }}
                              >
                                STATS
                              </button>
                            )}
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.1em' }}>VS</span>
                          </div>
                          )}

                          {renderPlayer(match, p2, 'player2', s2, false, o2)}
                        </div>
                      )
                    })}
                  </div>

                  {/* Right bracket connector — forward navigation */}
                  {hasForward && (
                    <button
                      onClick={() => {
                        const nextMatchId = feedMap[group[0].matchId]?.nextMatchId
                        if (nextMatchId) navigateForward(nextMatchId)
                      }}
                      className="bracket-nav-btn"
                      style={{
                        width: '48px', position: 'relative', flexShrink: 0, alignSelf: 'stretch',
                        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                      }}
                      aria-label="Go to next round"
                      title="View next round match"
                    >
                      {group.length === 2 ? (
                        <>
                          {/* Horizontal stub from top match midpoint */}
                          <div style={{ position: 'absolute', top: '25%', left: '0px', width: '40%', borderBottom: '1.5px solid var(--muted)' }} />
                          {/* Horizontal stub from bottom match midpoint */}
                          <div style={{ position: 'absolute', bottom: '25%', left: '0px', width: '40%', borderBottom: '1.5px solid var(--muted)' }} />
                          {/* Vertical line connecting the two stubs */}
                          <div style={{ position: 'absolute', top: '25%', bottom: '25%', left: '40%', borderRight: '1.5px solid var(--muted)' }} />
                          {/* Horizontal line from midpoint extending right */}
                          <div style={{ position: 'absolute', top: '50%', left: '40%', right: '4px', borderBottom: '1.5px solid var(--muted)' }} />
                        </>
                      ) : (
                        /* Single match: horizontal line */
                        <div style={{ position: 'absolute', top: '50%', left: '4px', right: '4px', borderBottom: '1.5px solid var(--muted)' }} />
                      )}
                    </button>
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
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving || pickedCount === 0}
                  className="px-5 py-2.5 text-sm rounded-sm border transition-colors disabled:opacity-40"
                  style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
                >
                  {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save draft'}
                </button>
                {/* Scoped to the round on screen. Placed before "Lock all picks"
                    because it is the safe one: it forfeits nothing, and it is
                    what most people on this screen actually want. */}
                {activeRoundLock.committable > 0 && (
                  <button
                    onClick={() => handleLockRound(activeRound)}
                    disabled={saving}
                    className="px-5 py-2.5 text-sm font-medium rounded-sm border transition-colors disabled:opacity-40"
                    style={{ borderColor: 'var(--court)', color: 'var(--court)' }}
                  >
                    {saving ? 'Locking…' : `Lock ${SHORT_ROUND_LABELS[activeRound] ?? activeRound} (${activeRoundLock.committable})`}
                  </button>
                )}
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
            {/* Shown before the click, not only in the confirm dialog — a native
                confirm is muscle-memory dismissed, and this is the one warning
                on the page that costs real points to miss. */}
            {unpickedOpenMatches > 0 && (
              <p
                className="rounded-sm px-3 py-2"
                style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'var(--chalk)', border: '1px solid var(--chalk-dim)' }}
              >
                <strong style={{ color: 'var(--ink)' }}>
                  Locking commits the {pickedCount} pick{pickedCount === 1 ? '' : 's'} you have made.
                </strong>{' '}
                The {unpickedOpenMatches} match{unpickedOpenMatches === 1 ? '' : 'es'} you have not picked
                {forfeitedRounds.length > 0 && <> — including {listRounds(forfeitedRounds)} — </>}{' '}
                stay open, so you can carry on picking as the draw opens up.
              </p>
            )}
            {/* The reason to lock at all. Until the multiplier was gated on it,
                locking was pure downside — irreversible, and worth nothing — which
                is why the button needed a warning and no explanation. Now it needs
                the explanation more. */}
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              <strong style={{ color: 'var(--ink)' }}>Locked picks earn the streak multiplier.</strong>{' '}
              Back the same player round after round and each correct pick is worth more than the last —
              but only on picks you committed before the match was played. Unlocked picks still score, at
              single value.{' '}
              <Link href="/faq#streak-multiplier" style={{ color: 'var(--court)' }}>How scoring works →</Link>
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              <Link href="/faq#lock-a-round" style={{ color: 'var(--court)' }}>Locking a round</Link>{' '}
              commits just that round and leaves the rest of your bracket editable.{' '}
              <Link href="/faq#lock-all-picks" style={{ color: 'var(--court)' }}>&quot;Lock all picks&quot;</Link>{' '}
              commits every pick you have made so far and cannot be undone — but the matches you have
              not picked stay open, so it never costs you a round. You can also lock
              one match at a time with the &quot;Lock pick&quot; button on it.
            </p>
          </div>
        )}

        {/* What the shading means, and what it buys.

            Sits at the very bottom, under the locking copy it belongs with:
            both answer the same question, and reading "locked picks earn the
            multiplier" immediately before "the multiplier is built on shaded
            players" is the order that makes either one land.

            Deliberately OUTSIDE the isEditing block above it. The hatching is
            drawn on read-only views too — the picks page, the admin bracket —
            and a legend that vanishes exactly where a reader has no other way
            to ask would be worse than one in the wrong place. */}
        <div
          className="mt-6 rounded-sm border px-4 py-3 flex flex-col gap-2"
          style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              aria-hidden
              style={{
                display: 'inline-block', width: '26px', height: '14px', borderRadius: '2px',
                border: '1px solid var(--chalk-dim)', backgroundColor: 'white',
                backgroundImage: PROJECTED_HATCH, flexShrink: 0,
              }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', letterSpacing: '0.04em', color: 'var(--ink)' }}>
              SHADED = YOUR PROJECTION
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            A shaded player is in this round because <strong>you</strong> picked them to get here — their
            previous match has not been played yet. A plain player is already through on a real result.
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            The streak multiplier counts the rounds below a pick that are still undecided when you
            commit it. Lock a semifinal pick before your player has played and four rounds are still
            open, so it pays ×5 if they get there; lock the same pick once they are already in the
            quarterfinals and only one round is left at stake, so it pays ×2. Backing a player who has
            <em> already</em> won their way through still scores full base points — it just pays at ×1.{' '}
            <Link href="/faq#streak-multiplier" style={{ color: 'var(--court)' }}>
              How the multiplier works →
            </Link>
          </p>
        </div>


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

      {/* Your-record drawer */}
      {statsPlayers && (
        <PlayerStatsDrawer
          key={`${statsPlayers.player1.externalId}-${statsPlayers.player2.externalId}`}
          player1={statsPlayers.player1}
          player2={statsPlayers.player2}
          onClose={() => setStatsPlayers(null)}
        />
      )}

      {/* H2H drawer */}
      {SHOW_H2H && h2hPlayers && (
        <H2HDrawer
          player1={h2hPlayers.player1}
          player2={h2hPlayers.player2}
          surface={tournament.surface ?? null}
          onClose={() => setH2HPlayers(null)}
        />
      )}
    </div>
  )
}
