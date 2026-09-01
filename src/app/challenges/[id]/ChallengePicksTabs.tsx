'use client'

import { useMemo, useState } from 'react'
import BracketPredictor from '@/app/tournaments/[slug]/predict/BracketPredictor'
import ChallengeComparison from './ChallengeComparison'
import { matchIdsInScope } from '@/lib/challenges/scope'
import type { Draw } from '@/lib/tennis/types'

export default function ChallengePicksTabs({
  tournament,
  draw,
  myPicks,
  theirPicks,
  myUsername,
  theirUsername,
  matchResults,
  myMatchPoints,
  theirMatchPoints,
  scopeRounds,
  progressiveReveal,
  theirHiddenCount,
  opponentJoined,
}: {
  tournament: any
  draw: Draw
  myPicks: Record<string, string>
  /**
   * Already filtered by the server when `progressiveReveal` is set — an
   * opponent's pick on an undecided match never reaches this bundle, so there
   * is nothing here for a reader of the RSC payload to lift.
   */
  theirPicks: Record<string, string>
  myUsername: string
  theirUsername: string
  matchResults: Record<string, string>
  myMatchPoints: Record<string, { points: number; streakMultiplier: number }>
  theirMatchPoints: Record<string, { points: number; streakMultiplier: number }>
  /** Rounds this challenge is played over. Undefined = the whole draw. */
  scopeRounds?: string[]
  /** Opponent picks reveal match by match rather than all at once. */
  progressiveReveal: boolean
  theirHiddenCount: number
  /** False until the challenge is accepted — there is no opponent bracket yet. */
  opponentJoined: boolean
}) {
  // Compare leads once there are two brackets: the side-by-side diff is what a
  // reader actually wants, and the single-bracket views stay one click away.
  // Before the opponent joins there is only one bracket, so it opens on it.
  const [activeTab, setActiveTab] = useState<'compare' | 'me' | 'them'>(
    opponentJoined ? 'compare' : 'me',
  )

  const effectiveTab = opponentJoined ? activeTab : 'me'
  const isBracketTab = effectiveTab === 'me' || effectiveTab === 'them'
  const activePicks = effectiveTab === 'them' ? theirPicks : myPicks
  const activeUsername = effectiveTab === 'them' ? theirUsername : myUsername
  const activeMatchPoints = effectiveTab === 'them' ? theirMatchPoints : myMatchPoints

  // Scope-limited: a challenge played from the quarters should not report
  // itself as "3/94 correct" using results from rounds it never covered.
  const scopedIds = useMemo(
    () => matchIdsInScope(draw.matches, draw.rounds, scopeRounds ? (scopeRounds[0] ?? null) : null),
    [draw, scopeRounds],
  )
  const scopedResults = useMemo(
    () => Object.keys(matchResults).filter(m => scopedIds.has(m)),
    [matchResults, scopedIds],
  )

  const correctCount = isBracketTab && scopedResults.length > 0
    ? scopedResults.filter(matchId => matchResults[matchId] === activePicks[matchId]).length
    : null

  // On the opponent's tab during progressive reveal the denominator is what has
  // been revealed, not the whole draw — anything else reads as them missing
  // picks they may well have made.
  const denominator = scopedResults.length

  const tabs = opponentJoined
    ? ([
        { key: 'compare' as const, label: 'Compare' },
        { key: 'me' as const, label: `${myUsername}'s picks` },
        { key: 'them' as const, label: `${theirUsername}'s picks` },
      ])
    : ([{ key: 'me' as const, label: 'Your picks' }])

  return (
    <div>
      <div className="flex items-center gap-0 mb-4 border-b overflow-x-auto" style={{ borderColor: 'var(--chalk-dim)' }}>
        {tabs.map(({ key, label }) => {
          const isActive = effectiveTab === key
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className="px-4 py-2.5 text-sm transition-colors"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                letterSpacing: '0.03em',
                whiteSpace: 'nowrap',
                color: isActive ? 'var(--court)' : 'var(--muted)',
                borderBottom: isActive ? '2px solid var(--court)' : '2px solid transparent',
                marginBottom: '-1px',
                background: 'transparent',
              }}
            >
              {label}
            </button>
          )
        })}
        {correctCount !== null && denominator > 0 && (
          <span className="ml-auto pl-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {correctCount}/{denominator} correct
          </span>
        )}
      </div>

      {effectiveTab === 'them' && progressiveReveal && theirHiddenCount > 0 && (
        <p
          className="mb-3"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--muted)', lineHeight: 1.6 }}
        >
          Showing only the picks whose match has been played. {theirHiddenCount} more
          {theirHiddenCount === 1 ? ' is' : ' are'} still face-down.
        </p>
      )}

      {effectiveTab === 'compare' ? (
        <ChallengeComparison
          draw={draw}
          myPicks={myPicks}
          theirPicks={theirPicks}
          myUsername={myUsername}
          theirUsername={theirUsername}
          matchResults={matchResults}
          myMatchPoints={myMatchPoints}
          theirMatchPoints={theirMatchPoints}
          scopeRounds={scopeRounds}
          progressiveReveal={progressiveReveal}
          theirHiddenCount={theirHiddenCount}
        />
      ) : (
        <BracketPredictor
          key={effectiveTab}
          tournament={tournament}
          draw={draw}
          existingPicks={activePicks}
          predictionId={null}
          username={activeUsername}
          matchResults={matchResults}
          matchPoints={activeMatchPoints}
          readOnly={true}
          hideSaveButtons={true}
          hideBackLink={true}
          hideNav={true}
          scopeRounds={scopeRounds}
        />
      )}
    </div>
  )
}
