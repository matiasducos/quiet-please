'use client'

import { useState } from 'react'
import BracketPredictor from '@/app/tournaments/[id]/predict/BracketPredictor'

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
  draw: any
  myPicks: Record<string, string>
  theirPicks: Record<string, string>
  myUsername: string
  theirUsername: string
  matchResults: Record<string, string>
  myMatchPoints: Record<string, { points: number; streakMultiplier: number }>
  theirMatchPoints: Record<string, { points: number; streakMultiplier: number }>
}) {
  const [activeTab, setActiveTab] = useState<'me' | 'them'>('me')

  const activePicks = activeTab === 'me' ? myPicks : theirPicks
  const activeUsername = activeTab === 'me' ? myUsername : theirUsername
  const activeMatchPoints = activeTab === 'me' ? myMatchPoints : theirMatchPoints

  // Count correct picks for the counter
  const resultsCount = Object.keys(matchResults).length
  const correctCount = resultsCount > 0
    ? Object.entries(activePicks).filter(([matchId, playerId]) => matchResults[matchId] === playerId).length
    : null

  return (
    <div>
      <div className="flex items-center gap-0 mb-4 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
        {([
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
    </div>
  )
}
