'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import BracketPredictor from '@/app/tournaments/[id]/predict/BracketPredictor'
import { createAnonymousChallenge } from '@/app/c/actions'

type Step = 'name' | 'picks' | 'submitting' | 'share'

export default function AnonymousCreateFlow({
  tournament,
  draw,
  matchResults,
}: {
  tournament: any
  draw: any
  matchResults: Record<string, string>
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handlePicksChange = useCallback((newPicks: Record<string, string>) => {
    setPicks(newPicks)
  }, [])

  const handleStartPicking = () => {
    setStep('picks')
  }

  const handleSubmit = async () => {
    if (Object.keys(picks).length === 0) {
      setError('Make at least one pick before submitting.')
      return
    }

    setStep('submitting')
    setError(null)

    // Generate creator token
    const creatorToken = crypto.randomUUID()

    const result = await createAnonymousChallenge({
      tournamentId: tournament.id,
      creatorName: name.trim() || `Player ${Math.floor(Math.random() * 9000) + 1000}`,
      creatorPicks: picks,
      creatorToken,
    })

    if (!result.ok) {
      setError(result.error)
      setStep('picks')
      return
    }

    // Store creator token in localStorage
    try {
      localStorage.setItem(`qp_challenge_${result.shareCode}`, creatorToken)
    } catch {
      // localStorage unavailable — user won't be recognized as creator on return
    }

    setShareCode(result.shareCode)
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

  // ── Step: Enter name ────────────────────────────────────────────────────
  if (step === 'name') {
    return (
      <div>
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Challenge a friend
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            {tournament.flag_emoji && <span style={{ marginRight: '3px' }}>{tournament.flag_emoji}</span>}
            {tournament.location ?? tournament.name} · {tournament.tour}
          </p>
        </div>

        <div className="bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <label
            htmlFor="creator-name"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}
          >
            Your name
          </label>
          <input
            id="creator-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            maxLength={30}
            className="w-full px-4 py-3 text-sm rounded-sm border mb-4"
            style={{ borderColor: 'var(--chalk-dim)', background: 'var(--chalk)', outline: 'none' }}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleStartPicking() }}
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
            This is how your opponent will see you. Leave blank for a random name.
          </p>
          <button
            onClick={handleStartPicking}
            className="w-full px-5 py-3 text-sm font-medium text-white rounded-sm hover:opacity-90"
            style={{ background: 'var(--court)' }}
          >
            Make your picks →
          </button>
        </div>
      </div>
    )
  }

  // ── Step: Make picks ────────────────────────────────────────────────────
  if (step === 'picks' || step === 'submitting') {
    const pickedCount = Object.keys(picks).length

    return (
      <div>
        <BracketPredictor
          tournament={tournament}
          draw={draw}
          existingPicks={picks}
          predictionId={null}
          username={name.trim() || 'You'}
          matchResults={matchResults}
          readOnly={false}
          hideSaveButtons={true}
          hideBackLink={true}
          onPicksChange={handlePicksChange}
        />

        {/* Custom submit area */}
        <div className="mt-8 pt-6 border-t flex flex-col gap-3" style={{ borderColor: 'var(--chalk-dim)' }}>
          {error && (
            <div className="rounded-sm px-4 py-3 text-sm" style={{ background: '#fdecea', color: '#c84b31', border: '1px solid #f5c0b8', fontFamily: 'var(--font-mono)' }}>
              {error}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              {pickedCount} pick{pickedCount !== 1 ? 's' : ''} made
            </span>
            <button
              onClick={handleSubmit}
              disabled={step === 'submitting' || pickedCount === 0}
              className="px-6 py-2.5 text-sm font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)' }}
            >
              {step === 'submitting' ? 'Creating challenge…' : 'Create challenge & get link →'}
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            Your picks will be locked once you create the challenge. Your opponent won&apos;t see them until they submit their own.
          </p>
        </div>
      </div>
    )
  }

  // ── Step: Share link ────────────────────────────────────────────────────
  if (step === 'share') {
    return (
      <div>
        <div className="mb-8 text-center">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem' }}>
            Challenge created!
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            Share this link with your opponent. Once they fill in their bracket, the competition begins.
          </p>
        </div>

        <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          {/* Tournament info */}
          <div className="mb-4 pb-4 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.15rem' }}>
              {tournament.flag_emoji && <span style={{ marginRight: '3px' }}>{tournament.flag_emoji}</span>}
              {tournament.location ?? tournament.name}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
              {tournament.name} · {tournament.tour}
            </div>
          </div>

          {/* Share link */}
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

            {/* WhatsApp share */}
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

        {/* CTA */}
        <div className="bg-white rounded-sm border p-5 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
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

  return null
}
