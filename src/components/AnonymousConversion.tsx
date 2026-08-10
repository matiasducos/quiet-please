'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { saveAnonymousEmail } from '@/app/c/actions'
import { authUrl } from '@/lib/auth-redirect'

/**
 * The ask at the end of an anonymous challenge.
 *
 * Someone who has just filled in an entire bracket from a friend's link is the
 * most qualified visitor this product ever gets, and until now the payoff was a
 * grey outlined link at the bottom of the page. This block replaces it with the
 * two things that are actually worth asking for at that moment:
 *
 *  1. An email address, so there is any way at all to reach them when the
 *     tournament finishes. Without it an anonymous player who wins is never
 *     told they won — the one moment that earns the account passes in silence.
 *  2. The account itself, as a real button rather than a whisper.
 *
 * The email is the softer ask and comes first deliberately: it costs one field
 * and no password, and it buys the right to make the second ask later, at a
 * moment when we have good news to open with.
 */

type Context = 'created' | 'submitted' | 'result'

const HEADLINES: Record<Context, string> = {
  created: 'Know how it ends',
  submitted: 'Know if you won',
  result: 'Know if you won',
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-3 text-sm font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
      style={{ background: 'var(--court)' }}
    >
      {pending ? 'Saving…' : 'Email me the result'}
    </button>
  )
}

export default function AnonymousConversion({
  shareCode,
  token,
  resultAlreadyIn = false,
  alreadySaved = false,
  context,
}: {
  shareCode: string
  /** The player's own token from localStorage. Without one they are a bystander
   *  viewing a shared link, not a player, and have no result to be told about. */
  token: string | null
  /** True when there is no result still to come, so there is nothing to promise.
   *  Callers reach that conclusion by different routes — a finished tournament
   *  before both brackets are in, a finished challenge after — which is why this
   *  is phrased as the question being asked rather than as either answer. */
  resultAlreadyIn?: boolean
  alreadySaved?: boolean
  context: Context
}) {
  const [saved, setSaved] = useState(alreadySaved)
  const [error, setError] = useState<string | null>(null)

  const signupHref = authUrl('/signup', `/c/${shareCode}`)

  // Nothing left to promise once the result is in, and a bystander has no claim
  // on one anyway. Both still get the account CTA — it is the only ask that
  // still means something.
  const canOfferEmail = Boolean(token) && !resultAlreadyIn

  async function handleSubmit(formData: FormData) {
    setError(null)
    const email = String(formData.get('email') ?? '')
    const result = await saveAnonymousEmail({ shareCode, token: token ?? '', email })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
  }

  return (
    <div
      className="rounded-sm border p-5 md:p-6 mb-6"
      style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}
    >
      {canOfferEmail && !saved && (
        <>
          <p
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.15rem',
              letterSpacing: '-0.01em',
              marginBottom: '0.35rem',
            }}
          >
            {HEADLINES[context]}
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
            Leave your email and we&apos;ll send you the final score when the tournament
            finishes — one email, nothing else.
          </p>

          <form action={handleSubmit} className="flex flex-col sm:flex-row gap-2">
            <label htmlFor="anon-email" className="sr-only">Your email</label>
            <input
              id="anon-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              maxLength={254}
              className="flex-1 min-w-0 px-4 py-3 text-sm rounded-sm border"
              style={{ borderColor: 'var(--chalk-dim)', background: 'var(--chalk)', outline: 'none' }}
            />
            <SubmitButton />
          </form>

          {error && (
            <p
              className="mt-2"
              style={{ fontSize: '0.75rem', color: '#c84b31', fontFamily: 'var(--font-mono)' }}
            >
              {error}
            </p>
          )}

          <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.75rem', lineHeight: 1.5 }}>
            Used for that one email and nothing else. We delete your address when we
            send it, and you can remove it sooner from any link we send.{' '}
            <a href="/privacy" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>
              Privacy
            </a>
          </p>
        </>
      )}

      {canOfferEmail && saved && (
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.05rem',
            letterSpacing: '-0.01em',
            marginBottom: '0.35rem',
          }}
        >
          Done — we&apos;ll email you the final score. ✓
        </p>
      )}

      {/* The account ask. Always a real button — never the grey whisper this
          replaced — but only the *primary* button when it is the only ask on
          screen. While the email form is up it is deliberately the second of
          two: two solid buttons of equal weight read as a choice the visitor
          has to make, and the email is the one we want them to make first. */}
      <div
        className={canOfferEmail ? 'mt-5 pt-5 border-t' : ''}
        style={canOfferEmail ? { borderColor: 'var(--chalk-dim)' } : undefined}
      >
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          {saved
            ? 'With an account your brackets are saved for the whole season — points, ranking, leagues and every tournament, not just this one.'
            : canOfferEmail
              // "Or" only makes sense as the second of two asks. On a finished
              // challenge the email form is gone and this is the only thing on
              // screen, so the conjunction would dangle.
              ? 'Or keep every bracket you make: points, a global ranking, leagues with friends, and the whole season in one place.'
              : 'Keep every bracket you make: points, a global ranking, leagues with friends, and the whole season in one place.'}
        </p>
        <a
          href={signupHref}
          className="inline-block w-full sm:w-auto text-center px-5 py-3 text-sm font-medium rounded-sm hover:opacity-90"
          style={
            canOfferEmail && !saved
              ? {
                  background: 'transparent',
                  color: 'var(--court)',
                  border: '1px solid var(--court)',
                  textDecoration: 'none',
                }
              : { background: 'var(--court)', color: 'white', textDecoration: 'none' }
          }
        >
          Create a free account →
        </a>
      </div>
    </div>
  )
}
