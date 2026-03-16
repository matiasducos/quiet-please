#!/bin/bash
set -e

cat > "src/app/tournaments/[id]/predict/BracketPredictor.tsx" << 'EOF'
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

const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']

export default function BracketPredictor({
  tournament,
  draw,
  existingPicks,
  predictionId,
  username,
}: {
  tournament: any
  draw: Draw
  existingPicks: Record<string, string>
  predictionId: string | null
  username: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [picks, setPicks] = useState<Record<string, string>>(existingPicks)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [activeRound, setActiveRound] = useState(() => {
    const sorted = draw.rounds.slice().sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
    return sorted[0] ?? 'QF'
  })

  const sortedRounds = draw.rounds.slice().sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
  const matchesForRound = (round: string) => draw.matches.filter(m => m.round === round)
  const totalMatches = draw.matches.length
  const pickedCount = Object.keys(picks).length

  const pickWinner = (matchId: string, playerExternalId: string) => {
    setPicks(prev => ({ ...prev, [matchId]: playerExternalId }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await savePrediction({ tournamentId: tournament.id, picks, predictionId })
      setSaved(true)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  const handleSubmit = async () => {
    if (!confirm('Lock your picks? This cannot be undone.')) return
    setSaving(true)
    try {
      await savePrediction({ tournamentId: tournament.id, picks, predictionId, lock: true })
      startTransition(() => router.push(`/tournaments/${tournament.id}`))
    } catch (e) { console.error(e); setSaving(false) }
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>

      {/* Nav */}
      <nav className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
            Quiet Please
          </Link>
          <div className="flex items-center gap-2 ml-4">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {pickedCount}/{totalMatches} picks
            </span>
            <button
              onClick={handleSave}
              disabled={saving || pickedCount === 0}
              className="px-3 py-1.5 text-xs rounded-sm border transition-colors disabled:opacity-40 whitespace-nowrap"
              style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
            >
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save draft'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || pickedCount === 0}
              className="px-3 py-1.5 text-xs font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
              style={{ background: 'var(--court)' }}
            >
              {saving ? 'Submitting…' : 'Submit & lock'}
            </button>
          </div>
        </div>
      </nav>

      {/* Header */}
      <div className="px-6 py-5 border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="flex items-center gap-2 mb-1" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href={`/tournaments/${tournament.id}`} style={{ color: 'var(--muted)' }}>{tournament.name}</Link>
          <span>/</span>
          <span>Your picks</span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
          Make your predictions
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
          Click a player to pick them as the winner. Locks on submit.
        </p>
      </div>

      {/* Round tabs */}
      <div className="flex border-b bg-white overflow-x-auto" style={{ borderColor: 'var(--chalk-dim)' }}>
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

      {/* Matches */}
      <div className="max-w-2xl mx-auto px-6 py-6">
        <div className="flex flex-col gap-4">
          {matchesForRound(activeRound).map((match, i) => {
            const p1 = match.player1
            const p2 = match.player2
            const pickedId = picks[match.matchId]

            return (
              <div key={match.matchId} className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
                <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>
                    MATCH {i + 1}
                  </span>
                </div>

                <button
                  onClick={() => p1 && pickWinner(match.matchId, p1.externalId)}
                  disabled={!p1}
                  className="w-full flex items-center justify-between px-4 py-4 border-b transition-all text-left"
                  style={{
                    borderColor: 'var(--chalk-dim)',
                    background: pickedId === p1?.externalId ? '#eaf3de' : 'white',
                    cursor: p1 ? 'pointer' : 'default',
                    opacity: !p1 ? 0.4 : 1,
                  }}
                >
                  <div className="flex items-center gap-3">
                    {p1?.seed && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', minWidth: '18px' }}>[{p1.seed}]</span>
                    )}
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: 'var(--ink)' }}>
                      {p1?.name ?? 'TBD'}
                    </span>
                    {p1?.country && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>{p1.country}</span>
                    )}
                  </div>
                  {pickedId === p1?.externalId && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#27500A', background: '#eaf3de', padding: '2px 8px', borderRadius: '2px', flexShrink: 0 }}>
                      picked
                    </span>
                  )}
                </button>

                <div className="flex items-center justify-center py-1" style={{ background: '#fafaf8' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.1em' }}>VS</span>
                </div>

                <button
                  onClick={() => p2 && pickWinner(match.matchId, p2.externalId)}
                  disabled={!p2}
                  className="w-full flex items-center justify-between px-4 py-4 transition-all text-left"
                  style={{
                    background: pickedId === p2?.externalId ? '#eaf3de' : 'white',
                    cursor: p2 ? 'pointer' : 'default',
                    opacity: !p2 ? 0.4 : 1,
                  }}
                >
                  <div className="flex items-center gap-3">
                    {p2?.seed && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', minWidth: '18px' }}>[{p2.seed}]</span>
                    )}
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: 'var(--ink)' }}>
                      {p2?.name ?? 'TBD'}
                    </span>
                    {p2?.country && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>{p2.country}</span>
                    )}
                  </div>
                  {pickedId === p2?.externalId && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#27500A', background: '#eaf3de', padding: '2px 8px', borderRadius: '2px', flexShrink: 0 }}>
                      picked
                    </span>
                  )}
                </button>
              </div>
            )
          })}
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

        {/* Submit area at bottom */}
        <div className="mt-8 pt-6 border-t flex flex-col gap-3" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="flex items-center justify-between">
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
                onClick={handleSubmit}
                disabled={saving || pickedCount === 0}
                className="px-5 py-2.5 text-sm font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: 'var(--court)' }}
              >
                {saving ? 'Submitting…' : 'Submit & lock picks'}
              </button>
            </div>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            Once locked, your picks cannot be changed.
          </p>
        </div>
      </div>
    </div>
  )
}
EOF

echo "✅ BracketPredictor nav fixed"
