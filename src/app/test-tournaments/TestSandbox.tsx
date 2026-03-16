'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { resetTestTournament, simulateResults } from './actions'
import { TEST_RESULTS, PLAYER_NAMES } from './constants'

const ROUND_LABEL: Record<string, string> = { QF: 'Quarterfinal', SF: 'Semifinal', F: 'Final' }

interface Props {
  tournament: {
    id: string
    name: string
    status: string
    surface: string | null
  } | null
  prediction: {
    id: string
    picks: unknown
    is_locked: boolean
    points_earned: number
  } | null
  hasResults: boolean
}

export default function TestSandbox({ tournament, prediction, hasResults }: Props) {
  const [isPending, startTransition] = useTransition()

  const handleReset = () => {
    startTransition(async () => { await resetTestTournament() })
  }

  const handleSimulate = () => {
    if (!tournament) return
    startTransition(async () => { await simulateResults(tournament.id) })
  }

  const picks = (prediction?.picks ?? {}) as Record<string, string>

  // ── State: no tournament yet ─────────────────────────────────────────────
  if (!tournament) {
    return (
      <div className="bg-white rounded-sm border p-8 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>
          No test tournament yet
        </p>
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          Create a fake Indian Wells tournament with a seeded QF bracket to start testing.
        </p>
        <button
          onClick={handleReset}
          disabled={isPending}
          className="px-6 py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-40"
          style={{ background: 'var(--court)' }}
        >
          {isPending ? 'Creating…' : 'Create test tournament'}
        </button>
      </div>
    )
  }

  // ── Shared: tournament card header ───────────────────────────────────────
  const TournamentHeader = () => (
    <div className="bg-white rounded-sm border overflow-hidden mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div style={{ background: '#185FA5', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', color: '#fff', fontWeight: 600, textTransform: 'uppercase' }}>
          Masters 1000
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em',
          background: tournament.status === 'accepting_predictions' ? '#eaf3de' : '#faeeda',
          color: tournament.status === 'accepting_predictions' ? '#27500A' : '#633806',
          padding: '3px 9px', borderRadius: '2px',
        }}>
          {tournament.status === 'accepting_predictions' ? 'Predictions open' : 'In progress'}
        </span>
      </div>
      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span>🇺🇸</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>Indian Wells, CA</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>· 9 – 22 Mar, 2026</span>
        </div>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em', marginBottom: '10px' }}>
          {tournament.name}
        </p>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em', textTransform: 'uppercase', background: '#edf2fb', color: '#185FA5', padding: '4px 10px', borderRadius: '2px' }}>
          Hard
        </span>
      </div>
    </div>
  )

  // ── State: results revealed ──────────────────────────────────────────────
  if (hasResults) {
    return (
      <div>
        <TournamentHeader />

        {/* Points summary */}
        <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Your score</h2>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', color: 'var(--court)' }}>
              {prediction?.points_earned ?? 0} pts
            </span>
          </div>

          {/* Results breakdown */}
          <div style={{ borderTop: '1px solid var(--chalk-dim)', paddingTop: '1rem' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
              Match results
            </p>
            <div className="flex flex-col gap-2">
              {TEST_RESULTS.map(r => {
                const userPick = picks[r.matchId]
                const correct = userPick === r.winner
                const missed  = userPick && userPick !== r.winner
                const noPick  = !userPick
                return (
                  <div key={r.matchId} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.06em',
                        color: 'var(--muted)', minWidth: '28px',
                      }}>
                        {r.round}
                      </span>
                      <span style={{ fontSize: '0.875rem', color: 'var(--ink)' }}>
                        <strong>{PLAYER_NAMES[r.winner]}</strong> def. {PLAYER_NAMES[r.loser]}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                        {r.score}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {correct && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', background: '#eaf3de', color: '#27500A', padding: '2px 8px', borderRadius: '2px' }}>
                          ✓ picked
                        </span>
                      )}
                      {missed && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', background: '#fdf2ed', color: '#993C1D', padding: '2px 8px', borderRadius: '2px' }}>
                          ✗ {PLAYER_NAMES[userPick]}
                        </span>
                      )}
                      {noPick && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>—</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Reset */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleReset}
            disabled={isPending}
            className="px-5 py-2.5 text-sm rounded-sm border transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
          >
            {isPending ? 'Resetting…' : '↺ Reset & start over'}
          </button>
          <Link
            href={`/tournaments/${tournament.id}`}
            style={{ fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'underline' }}
          >
            View tournament detail →
          </Link>
        </div>
      </div>
    )
  }

  // ── State: prediction locked, waiting to simulate ────────────────────────
  if (prediction?.is_locked) {
    return (
      <div>
        <TournamentHeader />

        <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.5rem' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', background: '#eaf3de', color: '#27500A', padding: '3px 9px', borderRadius: '2px' }}>
              Picks locked
            </span>
          </div>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
            Ready to reveal the results?
          </p>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            Click below to simulate the tournament — your picks will be scored against the real outcomes.
          </p>
          <button
            onClick={handleSimulate}
            disabled={isPending}
            className="px-6 py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--court)' }}
          >
            {isPending ? 'Simulating…' : 'Simulate results & score picks'}
          </button>
        </div>

        <button
          onClick={handleReset}
          disabled={isPending}
          className="px-4 py-2 text-sm rounded-sm border transition-colors disabled:opacity-40"
          style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
        >
          {isPending ? 'Resetting…' : '↺ Reset & start over'}
        </button>
      </div>
    )
  }

  // ── State: tournament ready, no locked picks yet ─────────────────────────
  return (
    <div>
      <TournamentHeader />

      <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
          Make your bracket picks
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          The draw has 8 players — QF through Final. Pick winners round by round, then lock your picks. You can edit until you lock.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Link
            href={`/tournaments/${tournament.id}/predict`}
            className="px-6 py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 inline-block"
            style={{ background: 'var(--court)' }}
          >
            {prediction ? 'Edit picks →' : 'Make predictions →'}
          </Link>
          {prediction && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
              {Object.keys(picks).length} of 7 picks saved
            </span>
          )}
        </div>
      </div>

      <button
        onClick={handleReset}
        disabled={isPending}
        className="px-4 py-2 text-sm rounded-sm border transition-colors disabled:opacity-40"
        style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
      >
        {isPending ? 'Resetting…' : '↺ Reset tournament'}
      </button>
    </div>
  )
}
