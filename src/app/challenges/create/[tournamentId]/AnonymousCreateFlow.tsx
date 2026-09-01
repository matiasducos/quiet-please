'use client'

import { useState, useCallback, useMemo } from 'react'
import BracketPredictor from '@/app/tournaments/[slug]/predict/BracketPredictor'
import { createAnonymousChallenge } from '@/app/c/actions'
import AnonymousConversion from '@/components/AnonymousConversion'
import { roundsInScope, matchIdsInScope, type ScopeOption } from '@/lib/challenges/scope'
import type { Draw } from '@/lib/tennis/types'

type Step = 'picks' | 'submitting' | 'share'

const mono = { fontFamily: 'var(--font-mono)' } as const

/**
 * Create an anonymous challenge: bracket first, everything else afterwards.
 *
 * There used to be an "enter your name" screen before the bracket, and the solo
 * flow at /play — which has never had one — carries the comment explaining why
 * that is wrong: a form field between the click and the thing the visitor was
 * promised is exactly the friction these pages exist to remove. The two flows
 * disagreed, and the numbers were not close: /play drew 170 people over three
 * months, this page drew two.
 *
 * The name is still asked for, on the submit bar, at the moment it first means
 * something — you are about to be someone's opponent.
 */
export default function AnonymousCreateFlow({
  tournament,
  draw,
  matchResults,
  adminLockedMatches,
  scopes,
}: {
  tournament: any
  draw: Draw
  matchResults: Record<string, string>
  adminLockedMatches?: Record<string, string>
  scopes: ScopeOption[]
}) {
  const [step, setStep] = useState<Step>('picks')
  const [name, setName] = useState('')
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [shareCode, setShareCode] = useState<string | null>(null)
  /** Kept after creation so the share step can prove to the server that this
   *  visitor is the creator when they leave an email address. */
  const [creatorToken, setCreatorToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Smallest contest on offer, for the same reason as the friends flow: the
  // full draw is 127 matches at a slam and is why these do not get finished.
  const [scopeRound, setScopeRound] = useState<string | null>(() => {
    const smallest = scopes.reduce<ScopeOption | null>(
      (best, o) => (!best || o.matchCount < best.matchCount ? o : best),
      null,
    )
    return smallest?.round ?? null
  })

  const scopedRounds = useMemo(
    () => (scopeRound ? roundsInScope(draw.rounds, scopeRound) : undefined),
    [draw.rounds, scopeRound],
  )
  const scopedIds = useMemo(
    () => matchIdsInScope(draw.matches, draw.rounds, scopeRound),
    [draw, scopeRound],
  )

  /** Picks the current scope actually covers — the count and the submit agree. */
  const picksInScope = useMemo(
    () => Object.fromEntries(Object.entries(picks).filter(([m]) => scopedIds.has(m))),
    [picks, scopedIds],
  )
  const pickedCount = Object.keys(picksInScope).length

  const handlePicksChange = useCallback((newPicks: Record<string, string>) => {
    setPicks(newPicks)
  }, [])

  const handleSubmit = async () => {
    if (pickedCount === 0) {
      setError('Make at least one pick before creating the challenge.')
      return
    }

    setStep('submitting')
    setError(null)

    const token = crypto.randomUUID()

    const result = await createAnonymousChallenge({
      tournamentId: tournament.id,
      creatorName: name.trim() || `Player ${Math.floor(Math.random() * 9000) + 1000}`,
      creatorPicks: picksInScope,
      creatorToken: token,
      scopeRound,
    })

    if (!result.ok) {
      setError(result.error)
      setStep('picks')
      return
    }

    try {
      localStorage.setItem(`qp_challenge_${result.shareCode}`, token)
    } catch {
      // localStorage unavailable — user won't be recognized as creator on return
    }

    setShareCode(result.shareCode)
    setCreatorToken(token)
    setStep('share')
  }

  const shareUrl = shareCode ? `${typeof window !== 'undefined' ? window.location.origin : ''}/c/${shareCode}` : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const input = document.createElement('input')
      input.value = shareUrl
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // ── Step: Make picks ────────────────────────────────────────────────────
  if (step === 'picks' || step === 'submitting') {
    return (
      <div>
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Challenge a friend
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.4rem' }}>
            {tournament.flag_emoji && <span style={{ marginRight: '3px' }}>{tournament.flag_emoji}</span>}
            {tournament.location ?? tournament.name} · {tournament.tour}
          </p>
        </div>

        {/* Stated when there is one legal scope, chosen when there is more
            than one. `availableScopes` returns exactly one today — a round
            cannot be played on its own until the players who reach it are
            known — so this is nearly always a statement of what you are about
            to fill in, which is worth saying when it is not the whole draw. */}
        {scopes.length === 1 && scopes[0].round && (
          <div
            className="rounded-sm border px-4 py-3 mb-5"
            style={{ borderColor: 'var(--chalk-dim)', background: '#f4f9ee' }}
          >
            <p style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '2px' }}>
              {scopes[0].label}
              <span style={{ ...mono, fontSize: '0.72rem', color: 'var(--muted)' }}>
                {' · '}{scopes[0].matchCount} match{scopes[0].matchCount === 1 ? '' : 'es'} each
              </span>
            </p>
            <p style={{ ...mono, fontSize: '0.66rem', color: 'var(--muted)', lineHeight: 1.6 }}>
              The earlier rounds have been played, so the contest starts here.
            </p>
          </div>
        )}

        {scopes.length > 1 && (
          <div className="mb-5">
            <p style={{ ...mono, fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.5rem' }}>
              How much of the draw
            </p>
            <div className="flex flex-wrap gap-2">
              {scopes.map(option => {
                const active = (option.round ?? null) === scopeRound
                return (
                  <button
                    key={option.round ?? 'full'}
                    type="button"
                    onClick={() => setScopeRound(option.round ?? null)}
                    style={{
                      ...mono,
                      fontSize: '0.7rem',
                      padding: '7px 12px',
                      borderRadius: '2px',
                      border: `1px solid ${active ? 'var(--court)' : 'var(--chalk-dim)'}`,
                      background: active ? 'var(--court)' : 'white',
                      color: active ? 'white' : 'var(--muted)',
                      textAlign: 'left',
                    }}
                  >
                    {option.label}
                    <span style={{ opacity: 0.75 }}> · {option.matchCount}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <BracketPredictor
          // Remounted when the scope changes so its internal pick state starts
          // from the filtered set rather than keeping picks the new scope has
          // just excluded.
          key={scopeRound ?? 'full'}
          tournament={tournament}
          draw={draw}
          existingPicks={picksInScope}
          predictionId={null}
          username={name.trim() || 'You'}
          matchResults={matchResults}
          readOnly={false}
          hideSaveButtons={true}
          hideBackLink={true}
          onPicksChange={handlePicksChange}
          adminLockedMatches={adminLockedMatches}
          scopeRounds={scopedRounds}
        />

        {/* Submit area — the name lives here rather than on a screen of its own. */}
        <div className="mt-8 pt-6 border-t flex flex-col gap-4" style={{ borderColor: 'var(--chalk-dim)' }}>
          {error && (
            <div className="rounded-sm px-4 py-3 text-sm" style={{ background: '#fdecea', color: '#c84b31', border: '1px solid #f5c0b8', ...mono }}>
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="creator-name"
              style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.4rem' }}
            >
              Your name
            </label>
            <input
              id="creator-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="How your opponent sees you (optional)"
              maxLength={30}
              className="w-full px-4 py-3 text-sm rounded-sm border"
              style={{ borderColor: 'var(--chalk-dim)', background: 'white', outline: 'none' }}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              {pickedCount} pick{pickedCount !== 1 ? 's' : ''} made
            </span>
            <button
              onClick={handleSubmit}
              disabled={step === 'submitting' || pickedCount === 0}
              className="w-full sm:w-auto px-6 py-2.5 text-sm font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)' }}
            >
              {step === 'submitting' ? 'Creating challenge…' : 'Create challenge & get link →'}
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            Your picks are locked in once you create the challenge. Neither of you sees the
            other&apos;s pick on a match until that match has been played.
          </p>
        </div>
      </div>
    )
  }

  // ── Step: Share link ────────────────────────────────────────────────────
  return (
    <div>
      <div className="mb-8 text-center">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem' }}>
          Challenge created
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
          Send this link to your opponent. Once they fill in their bracket, the contest begins.
        </p>
      </div>

      <div className="bg-white rounded-sm border p-4 md:p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="mb-4 pb-4 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.15rem' }}>
            {tournament.flag_emoji && <span style={{ marginRight: '3px' }}>{tournament.flag_emoji}</span>}
            {tournament.location ?? tournament.name}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            {tournament.name} · {tournament.tour} · {pickedCount} pick{pickedCount !== 1 ? 's' : ''}
          </div>
        </div>

        <div
          className="flex items-center gap-2 rounded-sm px-4 py-3 mb-4"
          style={{ background: 'var(--chalk)', border: '1px solid var(--chalk-dim)', ...mono, fontSize: '0.8rem', wordBreak: 'break-all' }}
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
            href={`https://wa.me/?text=${encodeURIComponent(`I challenge you! 🎾 Make your bracket picks for ${tournament.location ?? tournament.name}: ${shareUrl}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-5 py-3 text-sm text-center rounded-sm border hover:bg-white transition-colors"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none' }}
          >
            Share via WhatsApp
          </a>
        </div>
      </div>

      {/* The bracket is locked and the link is copied — from here the creator
          has nothing left to do, and no way to be told how it went. */}
      <AnonymousConversion
        shareCode={shareCode!}
        token={creatorToken}
        resultAlreadyIn={tournament.status === 'completed'}
        context="created"
      />
    </div>
  )
}
