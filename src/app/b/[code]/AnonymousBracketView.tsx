'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import BracketPredictor from '@/app/tournaments/[slug]/predict/BracketPredictor'
import BracketConversion from '@/components/BracketConversion'
import { claimAnonymousPrediction } from '@/app/play/actions'
import { scoreAnonymousPicks } from '@/lib/tennis/anonymous-scoring'
import { hashTokenInBrowser } from '@/lib/challenge-token'
import type { Round, TournamentCategory, DrawMatch } from '@/lib/tennis/types'

interface MatchResultEntry {
  external_match_id: string
  round: string
  winner_external_id: string
  score: string | null
}

type ClaimState =
  | { status: 'idle' }
  | { status: 'claiming' }
  | { status: 'claimed' }
  | { status: 'failed'; message: string }

export default function AnonymousBracketView({
  bracket,
  tournament,
  draw,
  matchResults,
  rawMatchResults,
  shareCode,
  isSignedIn,
  adminLockedMatches,
}: {
  bracket: any
  tournament: any
  draw: any
  matchResults: Record<string, string>
  rawMatchResults: MatchResultEntry[]
  shareCode: string
  isSignedIn: boolean
  adminLockedMatches?: Record<string, string>
}) {
  /** The author's own token, once this browser has proved it holds it. */
  const [myToken, setMyToken] = useState<string | null>(null)
  /** Distinguishes "not the author" from "haven't checked yet" — without it the
   *  conversion block flashes for a bystander on every load. */
  const [identityChecked, setIdentityChecked] = useState(false)
  const [claim, setClaim] = useState<ClaimState>(
    bracket.claimed_by ? { status: 'claimed' } : { status: 'idle' },
  )

  // Recognise the author by comparing a digest of their stored token against
  // the one in the payload — the raw token never leaves their machine.
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      let storedToken: string | null = null
      try {
        storedToken = localStorage.getItem(`qp_bracket_${shareCode}`)
      } catch {
        if (!cancelled) setIdentityChecked(true)
        return // localStorage unavailable — stay a viewer
      }
      if (!storedToken) {
        if (!cancelled) setIdentityChecked(true)
        return
      }

      let digest: string
      try {
        digest = await hashTokenInBrowser(storedToken)
      } catch {
        if (!cancelled) setIdentityChecked(true)
        return // no WebCrypto (insecure context) — stay a viewer
      }
      if (cancelled) return

      if (digest === bracket.token_hash) setMyToken(storedToken)
      setIdentityChecked(true)
    })()

    return () => { cancelled = true }
  }, [shareCode, bracket.token_hash])

  // Claiming is a button rather than something that fires on mount. Two
  // reasons: it writes a real prediction row and takes the user's weekly slot,
  // which is not a thing to do silently on a page load; and the failure cases
  // are all things the user needs to read as a response to their own action
  // ("your ATP slot that week is taken") rather than as an error banner that
  // appeared by itself.
  async function handleClaim() {
    if (!myToken || claim.status === 'claiming') return
    setClaim({ status: 'claiming' })
    const result = await claimAnonymousPrediction({ shareCode, token: myToken })
    setClaim(result.ok ? { status: 'claimed' } : { status: 'failed', message: result.error })
  }

  const score = useMemo(
    () =>
      scoreAnonymousPicks(
        (bracket.picks ?? {}) as Record<string, string>,
        rawMatchResults.map(r => ({ ...r, round: r.round as Round })),
        tournament.category as TournamentCategory,
        (draw?.matches ?? []) as DrawMatch[],
        (bracket.locked_picks ?? []) as string[],
      ),
    [bracket.picks, bracket.locked_picks, rawMatchResults, tournament.category, draw],
  )

  const isAuthor = Boolean(myToken)
  const tournamentOver = tournament.status === 'completed'
  const pickCount = Object.keys((bracket.picks ?? {}) as Record<string, string>).length

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
          {isAuthor ? 'Your bracket' : 'A bracket'}
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
          {tournament.flag_emoji && <span>{tournament.flag_emoji} </span>}
          {tournament.location ?? tournament.name}
        </h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          {bracket.display_name ? `${bracket.display_name} · ` : ''}
          {pickCount} pick{pickCount !== 1 ? 's' : ''} ·{' '}
          <strong style={{ color: 'var(--ink)' }}>{score.totalPoints} pts</strong> from{' '}
          {score.correctPicks} correct
        </p>
      </div>

      {/* ── Claim ─────────────────────────────────────────────────────── */}
      {/* The payoff for the account they just made. Only the author sees it —
          a bystander holding the link has nothing to claim. */}
      {identityChecked && isSignedIn && isAuthor && (claim.status === 'idle' || claim.status === 'claiming' || claim.status === 'failed') && (
        <div
          className="rounded-sm border p-5 md:p-6 mb-6"
          style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}
        >
          <p
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.15rem',
              letterSpacing: '-0.01em',
              marginBottom: '0.35rem',
            }}
          >
            Keep this bracket
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
            Save it to your account and it counts towards your points, your ranking and
            any leagues you&apos;re in.
          </p>
          <button
            onClick={handleClaim}
            disabled={claim.status === 'claiming'}
            className="w-full sm:w-auto px-5 py-3 text-sm font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--court)' }}
          >
            {claim.status === 'claiming' ? 'Saving…' : 'Save to my account →'}
          </button>
        </div>
      )}

      {claim.status === 'claimed' && (
        <div
          className="rounded-sm border p-5 md:p-6 mb-6"
          style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}
        >
          <p
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.15rem',
              letterSpacing: '-0.01em',
              marginBottom: '0.35rem',
            }}
          >
            Saved to your account ✓
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
            This bracket now counts towards your points and ranking. Points for matches
            already played are added on the next scoring run.
          </p>
          <Link
            href={`/tournaments/${tournament.id}/predict`}
            className="inline-block w-full sm:w-auto text-center px-5 py-3 text-sm font-medium rounded-sm hover:opacity-90"
            style={{ background: 'var(--court)', color: 'white', textDecoration: 'none' }}
          >
            Open it in my account →
          </Link>
        </div>
      )}

      {claim.status === 'failed' && (
        <div
          className="rounded-sm border px-4 py-3 mb-6"
          style={{ borderColor: '#f5c0b8', background: '#fdecea', fontSize: '0.85rem', color: '#c84b31', lineHeight: 1.5 }}
        >
          {claim.message}
        </div>
      )}

      {/* ── The ask ───────────────────────────────────────────────────── */}
      {/* Held back until the identity check has run: rendering it first and
          removing it a moment later is worse than a beat of nothing. */}
      {identityChecked && !isSignedIn && (
        <div className="mb-6">
          <BracketConversion
            shareCode={shareCode}
            token={myToken}
            resultAlreadyIn={tournamentOver}
            alreadySaved={Boolean(bracket.has_email)}
            context="revisit"
          />
        </div>
      )}

      <BracketPredictor
        tournament={tournament}
        draw={draw}
        existingPicks={(bracket.picks ?? {}) as Record<string, string>}
        predictionId={null}
        username={bracket.display_name ?? 'This bracket'}
        matchResults={matchResults}
        readOnly={true}
        hideSaveButtons={true}
        hideBackLink={true}
        adminLockedMatches={adminLockedMatches}
        lockedPicks={(bracket.locked_picks ?? []) as string[]}
      />
    </div>
  )
}
