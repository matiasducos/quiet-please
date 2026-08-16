'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { saveAnonymousPredictionEmail } from '@/app/play/actions'
import { authUrl } from '@/lib/auth-redirect'

/**
 * The ask at the end of a signed-out bracket.
 *
 * Sibling of `AnonymousConversion`, which does the same job for anonymous 1v1
 * challenges, and it keeps that component's ladder deliberately: email first,
 * account second. The email costs one field and no password and buys the right
 * to make the second ask later, at a moment when we have good news to open
 * with. Two solid buttons of equal weight would read as a choice, so while the
 * email form is up the account CTA is the outlined one.
 *
 * The account link carries `next=/b/<code>` so that the visitor lands back on
 * their own bracket after signing up — which is both the payoff they were
 * promised and the page that performs the claim.
 */

type Context = 'submitted' | 'revisit'

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

export default function BracketConversion({
  shareCode,
  token,
  resultAlreadyIn = false,
  alreadySaved = false,
  context,
}: {
  shareCode: string
  /** The author's own token from localStorage. Without one this visitor is a
   *  bystander who opened a shared link, not the person who made the bracket. */
  token: string | null
  /** True when the tournament is over, so there is no result left to promise. */
  resultAlreadyIn?: boolean
  alreadySaved?: boolean
  context: Context
}) {
  const [saved, setSaved] = useState(alreadySaved)
  const [error, setError] = useState<string | null>(null)

  const signupHref = authUrl('/signup', `/b/${shareCode}`)
  const canOfferEmail = Boolean(token) && !resultAlreadyIn

  async function handleSubmit(formData: FormData) {
    setError(null)
    const email = String(formData.get('email') ?? '')
    const result = await saveAnonymousPredictionEmail({ shareCode, token: token ?? '', email })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
  }

  return (
    <div
      className="rounded-sm border p-5 md:p-6"
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
            {context === 'submitted' ? 'Know how you did' : 'Know if you won'}
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
            Leave your email and we&apos;ll send you your final score when the tournament
            finishes — one email, nothing else.
          </p>

          <form action={handleSubmit} className="flex flex-col sm:flex-row gap-2">
            <label htmlFor="bracket-email" className="sr-only">Your email</label>
            <input
              id="bracket-email"
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
          Done — we&apos;ll email you your final score. ✓
        </p>
      )}

      <div
        className={canOfferEmail ? 'mt-5 pt-5 border-t' : ''}
        style={canOfferEmail ? { borderColor: 'var(--chalk-dim)' } : undefined}
      >
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          {saved
            ? 'With an account this bracket is saved for good — points, a global ranking, leagues with friends, and every tournament of the season.'
            : canOfferEmail
              ? 'Or create an account and this bracket comes with you: points, a global ranking, leagues with friends, and the whole season in one place.'
              : 'Create an account to keep every bracket you make: points, a global ranking, leagues with friends, and the whole season in one place.'}
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
          {token ? 'Save this bracket — free account →' : 'Create a free account →'}
        </a>
      </div>
    </div>
  )
}
