'use client'

import { useState, useCallback } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import BracketPredictor from '@/app/tournaments/[slug]/predict/BracketPredictor'
import BracketConversion from '@/components/BracketConversion'
import { submitAnonymousPrediction } from '@/app/play/actions'
import type { PlayableTournament, SubstitutionReason } from '@/lib/anonymous-predictions'

type Step = 'picks' | 'submitting' | 'done'

/**
 * There is deliberately no "enter your name" step before the bracket.
 *
 * The anonymous CHALLENGE flow opens with one because a challenge has an
 * opponent who needs someone to be playing against. Here the visitor arrived
 * from a social post seconds ago and owes us nothing; a form field between the
 * click and the thing they were promised is exactly the friction this whole
 * page exists to remove. The name is optional and asked for afterwards, if at
 * all.
 */
export default function SoloPlayFlow({
  tournament,
  draw,
  matchResults,
  adminLockedMatches,
  substitutedFor,
  totalMatches,
  decidedMatches,
  initialRound,
  embedded = false,
}: {
  tournament: PlayableTournament
  draw: any
  matchResults: Record<string, string>
  adminLockedMatches?: Record<string, string>
  /** Set when the link named a tournament we could not serve and a different
   *  open draw was used instead. Named and explained so the swap is admitted
   *  rather than hidden. */
  substitutedFor: { requestedName: string; reason: SubstitutionReason } | null
  totalMatches: number
  decidedMatches: number
  /** Round to open on, from `?round=` — see BracketPredictor.initialRound. */
  initialRound?: string
  /** Rendered inside the edition page (/tournaments/<slug>/<year>) rather than
   *  as the whole of /play. That page already owns the H1 and the tournament
   *  header, so the intro block is dropped and the saved state uses an h2 —
   *  two H1s on the page search lands on would be a real SEO regression. */
  embedded?: boolean
}) {
  const [step, setStep] = useState<Step>('picks')
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handlePicksChange = useCallback((next: Record<string, string>) => {
    setPicks(next)
  }, [])

  async function handleSubmit() {
    if (Object.keys(picks).length === 0) {
      setError('Make at least one pick before saving.')
      return
    }

    setStep('submitting')
    setError(null)

    const result = await submitAnonymousPrediction({
      tournamentId: tournament.id,
      displayName: '',
      picks,
    })

    if (!result.ok) {
      setError(result.error)
      setStep('picks')
      return
    }

    // The token is how this browser proves later that the bracket is its own —
    // to attach an email, and to claim it into an account after signup. It is
    // storage of content the visitor deliberately created rather than anything
    // that tracks them, and it matches the key the anonymous challenge flow
    // already writes for the same purpose.
    try {
      localStorage.setItem(`qp_bracket_${result.shareCode}`, result.token)
    } catch {
      // Private mode or storage disabled. The bracket is saved and scored
      // either way; this browser just won't be recognised as its author on a
      // later visit, so the conversion block below is shown from state now.
    }

    setShareCode(result.shareCode)
    setToken(result.token)
    setStep('done')
  }

  const pickedCount = Object.keys(picks).length
  const openMatches = Math.max(totalMatches - decidedMatches, 0)
  const isLate = decidedMatches > 0

  // ── Saved ───────────────────────────────────────────────────────────────
  if (step === 'done' && shareCode) {
    return (
      <div>
        <div className="mb-6 md:mb-8">
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
              letterSpacing: '0.08em',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              marginBottom: '0.75rem',
            }}
          >
            Bracket saved
          </p>
          <SavedHeading
            embedded={embedded}
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.75rem',
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
              marginBottom: '0.5rem',
            }}
          >
            {pickedCount} pick{pickedCount !== 1 ? 's' : ''} in for{' '}
            {tournament.flag_emoji && <span>{tournament.flag_emoji} </span>}
            {tournament.location ?? tournament.name}
          </SavedHeading>
          <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            It scores automatically as results come in. Your bracket lives at{' '}
            <Link href={`/b/${shareCode}`} style={{ color: 'var(--court)' }}>
              /b/{shareCode}
            </Link>
            .
          </p>
        </div>

        <BracketConversion shareCode={shareCode} token={token} context="submitted" />

        <div className="mt-6">
          <Link href={`/b/${shareCode}`} style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            View my bracket →
          </Link>
        </div>
      </div>
    )
  }

  // ── Filling in ──────────────────────────────────────────────────────────
  return (
    <div>
      {embedded ? (
        isLate && <LateNotice className="mb-4" decidedMatches={decidedMatches} openMatches={openMatches} />
      ) : (
      <div className="mb-6 md:mb-8">
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            letterSpacing: '0.08em',
            color: 'var(--muted)',
            textTransform: 'uppercase',
            marginBottom: '0.75rem',
          }}
        >
          No account needed
        </p>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.9rem',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            marginBottom: '0.5rem',
          }}
        >
          Predict {tournament.flag_emoji && <span>{tournament.flag_emoji} </span>}
          {tournament.location ?? tournament.name}
        </h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          Pick your winners, save the bracket, and we&apos;ll score it as the results come
          in. You can create an account afterwards to keep it.
        </p>

        {substitutedFor && (
          <div
            className="mt-4 rounded-sm border px-4 py-3"
            style={{ borderColor: 'var(--chalk-dim)', background: 'white', fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.5 }}
          >
            {substitutedFor.requestedName}{' '}
            {substitutedFor.reason === 'finished'
              ? 'is finished, so this is the next draw that’s open.'
              : 'hasn’t opened yet, so this is the next draw you can play.'}
          </div>
        )}

        {isLate && !substitutedFor && (
          <LateNotice className="mt-4" decidedMatches={decidedMatches} openMatches={openMatches} />
        )}
      </div>
      )}

      <BracketPredictor
        tournament={tournament}
        draw={draw}
        existingPicks={picks}
        predictionId={null}
        username="You"
        matchResults={matchResults}
        readOnly={false}
        hideSaveButtons={true}
        hideBackLink={true}
        // The host page owns the navigation and the heading; the predictor's
        // own header would be a second H1 restating it.
        hideNav={embedded}
        onPicksChange={handlePicksChange}
        adminLockedMatches={adminLockedMatches}
        initialRound={initialRound}
      />

      {/* Sticky, because the button used to sit below every match in the draw.
          In the full-draw view that is a long horizontal-and-vertical scroll
          away, and a visitor who made a dozen picks and never found "Save"
          left with nothing saved. Pinned to the viewport bottom it is always
          one tap from wherever they are in the bracket. */}
      <div
        className="sticky bottom-0 z-20 mt-8 -mx-4 px-4 md:mx-0 md:px-0 py-3 border-t flex flex-col gap-2"
        style={{ borderColor: 'var(--chalk-dim)', background: 'var(--chalk)' }}
      >
        {error && (
          <div
            className="rounded-sm px-4 py-3 text-sm"
            style={{ background: '#fdecea', color: '#c84b31', border: '1px solid #f5c0b8', fontFamily: 'var(--font-mono)' }}
          >
            {error}
          </div>
        )}
        {/* One row at every width: it is pinned over the bracket, so each
            pixel of height is a pixel of draw the visitor cannot see. */}
        <div className="flex items-center justify-between gap-3">
          <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            {pickedCount} pick{pickedCount !== 1 ? 's' : ''} made
          </span>
          <button
            onClick={handleSubmit}
            disabled={step === 'submitting' || pickedCount === 0}
            className="px-5 py-2.5 text-sm font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--court)' }}
          >
            {step === 'submitting' ? 'Saving…' : 'Save my bracket →'}
          </button>
        </div>
      </div>
      <p className="mt-2" style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.5 }}>
        No email or password needed to save. Picks on matches that have already been
        played score zero.
      </p>
    </div>
  )
}

function SavedHeading({
  embedded,
  style,
  children,
}: {
  embedded: boolean
  style: CSSProperties
  children: ReactNode
}) {
  return embedded ? <h2 style={style}>{children}</h2> : <h1 style={style}>{children}</h1>
}

function LateNotice({
  className,
  decidedMatches,
  openMatches,
}: {
  className: string
  decidedMatches: number
  openMatches: number
}) {
  return (
    <div
      className={`${className} rounded-sm border px-4 py-3`}
      style={{ borderColor: 'var(--chalk-dim)', background: 'white', fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.5 }}
    >
      This tournament is already under way — {decidedMatches} match
      {decidedMatches !== 1 ? 'es' : ''} played. You can still pick the {openMatches}{' '}
      that are left, including every round from here to the final.
    </div>
  )
}
