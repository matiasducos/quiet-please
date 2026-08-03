'use client'

import { useState } from 'react'
import BracketPredictor from '@/app/tournaments/[slug]/predict/BracketPredictor'
import ChallengeComparison from './ChallengeComparison'
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
}: {
  tournament: any
  draw: Draw
  myPicks: Record<string, string>
  theirPicks: Record<string, string>
  myUsername: string
  theirUsername: string
  matchResults: Record<string, string>
  myMatchPoints: Record<string, { points: number; streakMultiplier: number }>
  theirMatchPoints: Record<string, { points: number; streakMultiplier: number }>
}) {
  // Compare leads: the side-by-side diff is what a reader actually wants here,
  // and the single-bracket views stay one click away for the full picture.
  const [activeTab, setActiveTab] = useState<'compare' | 'me' | 'them'>('compare')

  const isBracketTab = activeTab === 'me' || activeTab === 'them'
  const activePicks = activeTab === 'them' ? theirPicks : myPicks
  const activeUsername = activeTab === 'them' ? theirUsername : myUsername
  const activeMatchPoints = activeTab === 'them' ? theirMatchPoints : myMatchPoints

  // Count correct picks for the counter — only meaningful on a single bracket;
  // the compare view carries its own summary.
  const resultsCount = Object.keys(matchResults).length
  const correctCount = isBracketTab && resultsCount > 0
    ? Object.entries(activePicks).filter(([matchId, playerId]) => matchResults[matchId] === playerId).length
    : null

  return (
    <div>
      <div className="flex items-center gap-0 mb-4 border-b overflow-x-auto" style={{ borderColor: 'var(--chalk-dim)' }}>
        {([
          { key: 'compare' as const, label: 'Compare' },
          { key: 'me' as const, label: `${myUsername}'s picks` },
          { key: 'them' as const, label: `${theirUsername}'s picks` },
        ]).map(({ key, label }) => {
          const isActive = activeTab === key
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
        {correctCount !== null && resultsCount > 0 && (
          <span className="ml-auto" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {correctCount}/{resultsCount} correct
          </span>
        )}
      </div>

      {activeTab === 'compare' ? (
        <ChallengeComparison
          draw={draw}
          myPicks={myPicks}
          theirPicks={theirPicks}
          myUsername={myUsername}
          theirUsername={theirUsername}
          matchResults={matchResults}
          myMatchPoints={myMatchPoints}
          theirMatchPoints={theirMatchPoints}
        />
      ) : (
        <BracketPredictor
          key={activeTab}
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
        />
      )}
    </div>
  )
}
