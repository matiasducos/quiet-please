'use client'

import { useState } from 'react'
import { createChallengeFromBracket } from '@/app/c/actions'

const mono = { fontFamily: 'var(--font-mono)' } as const

type State =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'ready'; url: string }
  | { status: 'failed'; message: string }

/**
 * Stake a saved bracket against a friend.
 *
 * Only rendered for the author, and only while the tournament is still open —
 * a bracket whose draw is finished has nothing to play for.
 */
export default function ChallengeFromBracket({
  shareCode,
  token,
  pickCount,
}: {
  shareCode: string
  /** The author's own token. Null means this browser is not the author. */
  token: string | null
  pickCount: number
}) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const [copied, setCopied] = useState(false)

  async function handleCreate() {
    if (!token || state.status === 'creating') return
    setState({ status: 'creating' })

    const result = await createChallengeFromBracket({ shareCode, token })
    if (!result.ok) {
      setState({ status: 'failed', message: result.error })
      return
    }

    // The challenge carries the bracket's token, so writing it under the
    // challenge's own key is what lets /c/<code> recognise this browser as the
    // creator rather than treating it as a bystander.
    try {
      localStorage.setItem(`qp_challenge_${result.shareCode}`, token)
    } catch {
      // localStorage unavailable — the link still works, the author just won't
      // be recognised when they return to it.
    }

    setState({ status: 'ready', url: `${window.location.origin}/c/${result.shareCode}` })
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard refused — the URL is on screen and selectable.
    }
  }

  return (
    <div
      className="rounded-sm border p-5 md:p-6 mb-6"
      style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}
    >
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', letterSpacing: '-0.01em', marginBottom: '0.35rem' }}>
        Play someone with it
      </p>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.55 }}>
        Send this bracket to a friend as a challenge. They fill in their own over the same{' '}
        {pickCount} match{pickCount === 1 ? '' : 'es'}, and whoever scores more points wins.
        Neither of you sees the other&apos;s pick on a match until it has been played.
      </p>

      {state.status === 'ready' ? (
        <div>
          <div
            className="rounded-sm px-4 py-3 mb-3"
            style={{ background: 'var(--chalk)', border: '1px solid var(--chalk-dim)', ...mono, fontSize: '0.78rem', wordBreak: 'break-all', color: 'var(--ink)' }}
          >
            {state.url}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => handleCopy(state.url)}
              className="px-5 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
              style={{ background: 'var(--court)' }}
            >
              {copied ? 'Copied! ✓' : 'Copy link'}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`I challenge you! 🎾 Make your bracket picks: ${state.url}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 text-sm text-center rounded-sm border"
              style={{ borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none' }}
            >
              Share via WhatsApp
            </a>
          </div>
        </div>
      ) : (
        <button
          onClick={handleCreate}
          disabled={state.status === 'creating'}
          className="w-full sm:w-auto px-5 py-2.5 text-sm font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: 'var(--court)' }}
        >
          {state.status === 'creating' ? 'Creating…' : 'Challenge a friend →'}
        </button>
      )}

      {state.status === 'failed' && (
        <p style={{ ...mono, fontSize: '0.72rem', color: '#c84b31', marginTop: '0.6rem', lineHeight: 1.5 }}>
          {state.message}
        </p>
      )}
    </div>
  )
}
