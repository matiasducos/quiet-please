#!/bin/bash
set -e
mkdir -p "src/app/tournaments/[id]/predict"
mkdir -p "src/app/api/predictions"

cat > "src/app/tournaments/[id]/predict/page.tsx" << 'EOF'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import BracketPredictor from './BracketPredictor'

export default async function PredictPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { id } = await params

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', id)
    .single()

  if (!tournament) notFound()
  if (tournament.status !== 'accepting_predictions') redirect(`/tournaments/${id}`)

  const { data: draw } = await supabase
    .from('draws')
    .select('bracket_data')
    .eq('tournament_id', id)
    .single()

  if (!draw?.bracket_data) redirect(`/tournaments/${id}`)

  const { data: prediction } = await supabase
    .from('predictions')
    .select('id, picks, is_locked')
    .eq('tournament_id', id)
    .eq('user_id', user.id)
    .single()

  if (prediction?.is_locked) redirect(`/tournaments/${id}`)

  const { data: profile } = await supabase
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single()

  return (
    <BracketPredictor
      tournament={tournament}
      draw={draw.bracket_data as any}
      existingPicks={(prediction?.picks as Record<string, string>) ?? {}}
      predictionId={prediction?.id ?? null}
      username={profile?.username ?? ''}
    />
  )
}
EOF

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
  R128: 'Round of 128', R64: 'Round of 64', R32: 'Round of 32',
  R16: 'Round of 16', QF: 'Quarterfinals', SF: 'Semifinals', F: 'Final',
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
  const [isPending, startTransition] = useTransition()
  const [picks, setPicks] = useState<Record<string, string>>(existingPicks)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [activeRound, setActiveRound] = useState(() => {
    const sorted = draw.rounds.slice().sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
    return sorted[0] ?? 'QF'
  })

  // Get sorted rounds
  const sortedRounds = draw.rounds.slice().sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))

  // For a given round, get the matches
  const matchesForRound = (round: string) => draw.matches.filter(m => m.round === round)

  // Get who won a previous round match (from picks)
  // For later rounds, the players are determined by who was picked in earlier rounds
  const getPlayerForSlot = (matchId: string, slot: 'player1' | 'player2'): Player | null => {
    const match = draw.matches.find(m => m.matchId === matchId)
    if (!match) return null
    return match[slot]
  }

  // Pick a winner for a match
  const pickWinner = (matchId: string, playerExternalId: string) => {
    setPicks(prev => ({
      ...prev,
      [matchId]: playerExternalId,
    }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await savePrediction({ tournamentId: tournament.id, picks, predictionId })
      setSaved(true)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async () => {
    setSaving(true)
    try {
      await savePrediction({ tournamentId: tournament.id, picks, predictionId, lock: true })
      startTransition(() => router.push(`/tournaments/${tournament.id}`))
    } catch (e) {
      console.error(e)
      setSaving(false)
    }
  }

  const totalMatches = draw.matches.length
  const pickedCount = Object.keys(picks).length

  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>
        <div className="flex items-center gap-4">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
            {pickedCount}/{totalMatches} picks made
          </span>
          <button
            onClick={handleSave}
            disabled={saving || pickedCount === 0}
            className="px-4 py-2 text-sm rounded-sm border transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save draft'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || pickedCount === 0}
            className="px-4 py-2 text-sm font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--court)' }}
          >
            {saving ? 'Submitting…' : 'Submit & lock picks'}
          </button>
        </div>
      </nav>

      {/* Header */}
      <div className="px-8 py-6 border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="flex items-center gap-2 mb-2" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href={`/tournaments/${tournament.id}`} style={{ color: 'var(--muted)' }}>{tournament.name}</Link>
          <span>/</span>
          <span>Your picks</span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', letterSpacing: '-0.02em' }}>
          Make your predictions
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
          Click on a player to pick them as the winner. Your picks lock when you submit.
        </p>
      </div>

      {/* Round tabs */}
      <div className="flex gap-0 border-b bg-white overflow-x-auto" style={{ borderColor: 'var(--chalk-dim)' }}>
        {sortedRounds.map(round => (
          <button
            key={round}
            onClick={() => setActiveRound(round)}
            className="px-6 py-3 text-sm whitespace-nowrap border-b-2 transition-colors"
            style={{
              borderBottomColor: activeRound === round ? 'var(--court)' : 'transparent',
              color: activeRound === round ? 'var(--court)' : 'var(--muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              letterSpacing: '0.05em',
            }}
          >
            {ROUND_LABELS[round] ?? round}
          </button>
        ))}
      </div>

      {/* Matches */}
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="flex flex-col gap-4">
          {matchesForRound(activeRound).map((match, i) => {
            const p1 = getPlayerForSlot(match.matchId, 'player1')
            const p2 = getPlayerForSlot(match.matchId, 'player2')
            const pickedId = picks[match.matchId]

            return (
              <div key={match.matchId} className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>

                {/* Match number */}
                <div className="px-5 py-2 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>
                    MATCH {i + 1}
                  </span>
                </div>

                {/* Player 1 */}
                <button
                  onClick={() => p1 && pickWinner(match.matchId, p1.externalId)}
                  disabled={!p1}
                  className="w-full flex items-center justify-between px-5 py-4 border-b transition-all text-left"
                  style={{
                    borderColor: 'var(--chalk-dim)',
                    background: pickedId === p1?.externalId ? '#eaf3de' : 'white',
                    cursor: p1 ? 'pointer' : 'default',
                    opacity: !p1 ? 0.4 : 1,
                  }}
                >
                  <div className="flex items-center gap-3">
                    {p1?.seed && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', minWidth: '20px' }}>
                        [{p1.seed}]
                      </span>
                    )}
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
                      {p1?.name ?? 'TBD'}
                    </span>
                    {p1?.country && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                        {p1.country}
                      </span>
                    )}
                  </div>
                  {pickedId === p1?.externalId && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#27500A', background: '#eaf3de', padding: '2px 8px', borderRadius: '2px' }}>
                      picked
                    </span>
                  )}
                </button>

                {/* VS divider */}
                <div className="flex items-center justify-center py-1" style={{ background: '#fafaf8' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.1em' }}>VS</span>
                </div>

                {/* Player 2 */}
                <button
                  onClick={() => p2 && pickWinner(match.matchId, p2.externalId)}
                  disabled={!p2}
                  className="w-full flex items-center justify-between px-5 py-4 transition-all text-left"
                  style={{
                    background: pickedId === p2?.externalId ? '#eaf3de' : 'white',
                    cursor: p2 ? 'pointer' : 'default',
                    opacity: !p2 ? 0.4 : 1,
                  }}
                >
                  <div className="flex items-center gap-3">
                    {p2?.seed && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', minWidth: '20px' }}>
                        [{p2.seed}]
                      </span>
                    )}
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
                      {p2?.name ?? 'TBD'}
                    </span>
                    {p2?.country && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                        {p2.country}
                      </span>
                    )}
                  </div>
                  {pickedId === p2?.externalId && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#27500A', background: '#eaf3de', padding: '2px 8px', borderRadius: '2px' }}>
                      picked
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* Round navigation */}
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={() => {
              const idx = sortedRounds.indexOf(activeRound)
              if (idx > 0) setActiveRound(sortedRounds[idx - 1])
            }}
            disabled={sortedRounds.indexOf(activeRound) === 0}
            className="px-5 py-2 text-sm rounded-sm border transition-colors disabled:opacity-30"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
          >
            ← Previous round
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
            {ROUND_LABELS[activeRound] ?? activeRound}
          </span>
          <button
            onClick={() => {
              const idx = sortedRounds.indexOf(activeRound)
              if (idx < sortedRounds.length - 1) setActiveRound(sortedRounds[idx + 1])
            }}
            disabled={sortedRounds.indexOf(activeRound) === sortedRounds.length - 1}
            className="px-5 py-2 text-sm rounded-sm border transition-colors disabled:opacity-30"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
          >
            Next round →
          </button>
        </div>
      </div>
    </div>
  )
}
EOF

cat > "src/app/tournaments/[id]/predict/actions.ts" << 'EOF'
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function savePrediction({
  tournamentId,
  picks,
  predictionId,
  lock = false,
}: {
  tournamentId: string
  picks: Record<string, string>
  predictionId: string | null
  lock?: boolean
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const row = {
    user_id:      user.id,
    tournament_id: tournamentId,
    picks,
    is_locked:    lock,
    updated_at:   new Date().toISOString(),
  }

  if (predictionId) {
    const { error } = await supabase
      .from('predictions')
      .update(row)
      .eq('id', predictionId)
      .eq('user_id', user.id)
      .eq('is_locked', false)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('predictions')
      .insert({ ...row, submitted_at: new Date().toISOString() })
    if (error) throw error
  }

  revalidatePath(`/tournaments/${tournamentId}`)
}
EOF

echo "✅ Bracket prediction UI written"
