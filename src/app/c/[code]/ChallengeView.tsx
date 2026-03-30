'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import Link from 'next/link'
import BracketPredictor from '@/app/tournaments/[id]/predict/BracketPredictor'
import { submitOpponentPicks } from '../actions'
import { scoreAnonymousPicks } from '@/lib/tennis/anonymous-scoring'
import type { Round, TournamentCategory, DrawMatch } from '@/lib/tennis/types'

interface MatchResultEntry {
  external_match_id: string
  round: string
  winner_external_id: string
  score: string | null
}

export default function ChallengeView({
  challenge,
  tournament,
  draw,
  matchResults,
  rawMatchResults,
  shareCode,
  adminLockedMatches,
}: {
  challenge: any
  tournament: any
  draw: any
  matchResults: Record<string, string>
  rawMatchResults: MatchResultEntry[]
  shareCode: string
  adminLockedMatches?: Record<string, string>
}) {
  const [role, setRole] = useState<'creator' | 'opponent' | 'viewer'>('viewer')
  const [opponentName, setOpponentName] = useState('')
  const [opponentPicks, setOpponentPicks] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [bracketTab, setBracketTab] = useState<'creator' | 'opponent'>('creator')

  // Check localStorage for tokens on mount
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem(`qp_challenge_${shareCode}`)
      if (storedToken && storedToken === challenge.creator_token) {
        setRole('creator')
      } else if (storedToken && storedToken === challenge.opponent_token) {
        setRole('opponent')
      }
    } catch {
      // localStorage unavailable
    }
  }, [shareCode, challenge.creator_token, challenge.opponent_token])

  const handlePicksChange = useCallback((newPicks: Record<string, string>) => {
    setOpponentPicks(newPicks)
  }, [])

  const handleSubmitOpponent = async () => {
    if (Object.keys(opponentPicks).length === 0) {
      setError('Make at least one pick before submitting.')
      return
    }

    setSubmitting(true)
    setError(null)

    const opToken = crypto.randomUUID()

    const result = await submitOpponentPicks({
      shareCode,
      opponentName: opponentName.trim() || `Player ${Math.floor(Math.random() * 9000) + 1000}`,
      opponentPicks,
      opponentToken: opToken,
    })

    if (!result.ok) {
      setError(result.error)
      setSubmitting(false)
      return
    }

    // Store opponent token
    try {
      localStorage.setItem(`qp_challenge_${shareCode}`, opToken)
    } catch {}

    setSubmitted(true)
    setSubmitting(false)
    setRole('opponent')
  }

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/c/${shareCode}` : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  // ── Compute live scores ─────────────────────────────────────────────────
  const matches = (draw?.matches ?? []) as DrawMatch[]
  const typedResults = rawMatchResults.map(r => ({
    external_match_id: r.external_match_id,
    round: r.round as Round,
    winner_external_id: r.winner_external_id,
    score: r.score,
  }))
  const category = tournament?.category as TournamentCategory | undefined

  const creatorScore = challenge.creator_picks && category
    ? scoreAnonymousPicks(challenge.creator_picks, typedResults, category, matches)
    : { totalPoints: 0, correctPicks: 0, totalResults: 0 }

  const opponentScore = (challenge.opponent_picks || submitted) && category
    ? scoreAnonymousPicks(challenge.opponent_picks ?? opponentPicks, typedResults, category, matches)
    : null

  // Use DB-stored points if available (cron-scored), otherwise use live client-side scoring
  const creatorPoints = challenge.challenger_points ?? creatorScore.totalPoints
  const opponentPoints = challenge.challenged_points ?? opponentScore?.totalPoints ?? 0

  const isCompleted = challenge.status === 'completed'
  const bothSubmitted = challenge.status === 'active' || isCompleted || submitted

  // ── State 1: Creator waiting for opponent ─────────────────────────────
  if (challenge.status === 'waiting_opponent' && role === 'creator' && !submitted) {
    return (
      <div>
        <div className="mb-8 text-center">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem' }}>
            Waiting for your opponent
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            {tournament?.flag_emoji && <span style={{ marginRight: '3px' }}>{tournament.flag_emoji}</span>}
            {tournament?.location ?? tournament?.name} · {tournament?.tour}
          </p>
        </div>

        <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>Share this link</p>
          <div
            className="flex items-center gap-2 rounded-sm px-4 py-3 mb-4"
            style={{ background: 'var(--chalk)', border: '1px solid var(--chalk-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', wordBreak: 'break-all' }}
          >
            <span className="flex-1" style={{ color: 'var(--ink)' }}>{shareUrl}</span>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleCopy}
              className="w-full px-5 py-3 text-sm font-medium text-white rounded-sm hover:opacity-90"
              style={{ background: 'var(--court)' }}
            >
              {copied ? 'Copied! ✓' : 'Copy link'}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`I challenge you! 🎾 Make your bracket picks: ${shareUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full px-5 py-3 text-sm text-center rounded-sm border"
              style={{ borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none' }}
            >
              Share via WhatsApp
            </a>
          </div>
        </div>

        {/* Show creator's own picks (read-only) */}
        <div className="mb-4">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>Your picks</h2>
        </div>
        <BracketPredictor
          tournament={tournament}
          draw={draw}
          existingPicks={challenge.creator_picks ?? {}}
          predictionId={null}
          username={challenge.creator_name ?? 'You'}
          matchResults={matchResults}
          readOnly={true}
          hideSaveButtons={true}
          hideBackLink={true}
          adminLockedMatches={adminLockedMatches}
        />
      </div>
    )
  }

  // ── State 2: Opponent's turn (no token, waiting_opponent) ─────────────
  if (challenge.status === 'waiting_opponent' && role !== 'creator' && !submitted) {
    return (
      <div>
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem' }}>
            {challenge.creator_name} challenged you!
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            {tournament?.flag_emoji && <span style={{ marginRight: '3px' }}>{tournament.flag_emoji}</span>}
            {tournament?.location ?? tournament?.name} · {tournament?.tour}
          </p>
        </div>

        {/* Name input */}
        <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <label
            htmlFor="opponent-name"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}
          >
            Your name
          </label>
          <input
            id="opponent-name"
            type="text"
            value={opponentName}
            onChange={(e) => setOpponentName(e.target.value)}
            placeholder="Enter your name"
            maxLength={30}
            className="w-full px-4 py-3 text-sm rounded-sm border"
            style={{ borderColor: 'var(--chalk-dim)', background: 'var(--chalk)', outline: 'none' }}
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
            Fill in your bracket below and submit to accept the challenge.
          </p>
        </div>

        {/* Bracket predictor */}
        <BracketPredictor
          tournament={tournament}
          draw={draw}
          existingPicks={opponentPicks}
          predictionId={null}
          username={opponentName.trim() || 'You'}
          matchResults={matchResults}
          readOnly={false}
          hideSaveButtons={true}
          hideBackLink={true}
          onPicksChange={handlePicksChange}
          adminLockedMatches={adminLockedMatches}
        />

        {/* Submit button */}
        <div className="mt-8 pt-6 border-t flex flex-col gap-3" style={{ borderColor: 'var(--chalk-dim)' }}>
          {error && (
            <div className="rounded-sm px-4 py-3 text-sm" style={{ background: '#fdecea', color: '#c84b31', border: '1px solid #f5c0b8', fontFamily: 'var(--font-mono)' }}>
              {error}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              {Object.keys(opponentPicks).length} pick{Object.keys(opponentPicks).length !== 1 ? 's' : ''} made
            </span>
            <button
              onClick={handleSubmitOpponent}
              disabled={submitting || Object.keys(opponentPicks).length === 0}
              className="px-6 py-2.5 text-sm font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)' }}
            >
              {submitting ? 'Submitting…' : 'Accept challenge & lock picks →'}
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            Your picks will be locked once submitted. Both brackets will be revealed.
          </p>
        </div>
      </div>
    )
  }

  // ── State 3 & 4: Both submitted (active or completed) ─────────────────
  if (bothSubmitted) {
    const creatorWinning = creatorPoints > opponentPoints
    const opponentWinning = opponentPoints > creatorPoints
    const tied = creatorPoints === opponentPoints

    return (
      <div>
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem' }}>
            {challenge.creator_name ?? 'Player 1'} <span style={{ color: 'var(--muted)' }}>vs</span> {challenge.opponent_name ?? (opponentName || 'Player 2')}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            {tournament?.flag_emoji && <span style={{ marginRight: '3px' }}>{tournament.flag_emoji}</span>}
            {tournament?.location ?? tournament?.name} · {tournament?.tour}
          </p>
        </div>

        {/* Score card */}
        <div
          className="rounded-sm border p-6 mb-6 text-center"
          style={{
            borderColor: isCompleted
              ? (tied ? 'var(--chalk-dim)' : creatorWinning ? '#97C459' : '#f4c5ba')
              : 'var(--chalk-dim)',
            background: isCompleted
              ? (tied ? 'var(--chalk)' : creatorWinning ? '#eaf3de' : '#fdf1ee')
              : 'white',
          }}
        >
          {isCompleted && (
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.5rem',
              letterSpacing: '-0.02em',
              color: tied ? 'var(--ink)' : creatorWinning ? '#27500A' : '#c84b31',
              marginBottom: '0.5rem',
            }}>
              {tied ? 'Draw!' : creatorWinning
                ? `${challenge.creator_name ?? 'Player 1'} wins!`
                : `${challenge.opponent_name ?? 'Player 2'} wins!`}
            </p>
          )}
          {!isCompleted && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
              {rawMatchResults.filter(r => r.score !== 'BYE').length > 0 ? 'Live score' : 'Score'}
            </div>
          )}

          <div className="flex items-center justify-center gap-4" style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem' }}>
            <div className="text-right flex-1">
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.15rem' }}>
                {challenge.creator_name ?? 'Player 1'}
              </div>
              <span style={{ color: creatorWinning ? 'var(--court)' : 'var(--ink)' }}>
                {creatorPoints}
              </span>
            </div>
            <span style={{ color: 'var(--muted)', fontSize: '1rem' }}>–</span>
            <div className="text-left flex-1">
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.15rem' }}>
                {challenge.opponent_name ?? (opponentName || 'Player 2')}
              </div>
              <span style={{ color: opponentWinning ? '#c84b31' : 'var(--ink)' }}>
                {opponentPoints}
              </span>
            </div>
          </div>

          {!isCompleted && rawMatchResults.filter(r => r.score !== 'BYE').length > 0 && (
            <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
              {rawMatchResults.filter(r => r.score !== 'BYE').length} match{rawMatchResults.filter(r => r.score !== 'BYE').length !== 1 ? 'es' : ''} played
            </p>
          )}
        </div>

        {/* Bracket tabs */}
        {draw?.matches && (
          <div className="mb-6">
            <div className="flex items-center gap-0 mb-4 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
              {(['creator', 'opponent'] as const).map((tab) => {
                const isActive = bracketTab === tab
                const label = tab === 'creator'
                  ? `${challenge.creator_name ?? 'Player 1'}'s picks`
                  : `${challenge.opponent_name ?? (opponentName || 'Player 2')}'s picks`
                return (
                  <button
                    key={tab}
                    onClick={() => setBracketTab(tab)}
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
              {/* Correct counter */}
              {(() => {
                const activePicks = bracketTab === 'creator'
                  ? (challenge.creator_picks ?? {})
                  : (challenge.opponent_picks ?? opponentPicks)
                const resultsCount = Object.keys(matchResults).length
                if (resultsCount === 0) return null
                const correctCount = Object.entries(activePicks).filter(
                  ([matchId, playerId]) => matchResults[matchId] === playerId
                ).length
                return (
                  <span className="ml-auto" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {correctCount}/{resultsCount} correct
                  </span>
                )
              })()}
            </div>

            <BracketPredictor
              key={bracketTab}
              tournament={tournament}
              draw={draw}
              existingPicks={bracketTab === 'creator'
                ? (challenge.creator_picks ?? {})
                : (challenge.opponent_picks ?? opponentPicks)}
              predictionId={null}
              username={bracketTab === 'creator'
                ? (challenge.creator_name ?? 'Player 1')
                : (challenge.opponent_name ?? (opponentName || 'Player 2'))}
              matchResults={matchResults}
              readOnly={true}
              hideSaveButtons={true}
              hideBackLink={true}
              hideNav={true}
              adminLockedMatches={adminLockedMatches}
            />
          </div>
        )}

        {/* CTA for non-logged-in users */}
        <div className="bg-white rounded-sm border p-5 mb-6 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
            Want to track your stats, join leagues, and compete on the global leaderboard?
          </p>
          <a
            href="/signup"
            className="inline-block px-5 py-2 text-sm rounded-sm border"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--court)', textDecoration: 'none' }}
          >
            Create a free account →
          </a>
        </div>
      </div>
    )
  }

  // Fallback — shouldn't normally reach here
  return (
    <div className="text-center py-16">
      <p style={{ color: 'var(--muted)' }}>Loading challenge...</p>
    </div>
  )
}
