'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import posthog from 'posthog-js'
import { subscribeToDrawReminder } from './actions'

/**
 * The one thing an upcoming edition page can offer a signed-out visitor.
 *
 * Before this, a search result for "Chengdu Open 2026" landed on a page whose
 * every call to action was gated behind a draw that will not exist for months.
 * The visitor read one paragraph telling them to come back later and left, and
 * the intent that brought them was not captured by anything.
 *
 * Same ladder as `BracketConversion`: email first, account second. The email
 * costs one field and no password, and it buys the right to make the account
 * ask later — in an inbox, at the moment the draw actually lands, which is when
 * there is finally a bracket worth having an account for. So while the email
 * form is up, the account CTA is the outlined one; two solid buttons would read
 * as a fork rather than a primary path with a shortcut.
 *
 * Stores nothing client-side. The success state lives in React for this page
 * view only, which is deliberate — remembering it across visits would mean a
 * cookie or localStorage entry, and that is a non-essential store that would
 * have to pass the `canStore` consent gate in middleware.ts. Not worth a
 * consent decision to save someone from typing an address they can re-submit
 * for free (the upsert is idempotent).
 */

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-3 text-sm font-medium text-white rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
      style={{ background: 'var(--court)' }}
    >
      {pending ? 'Saving…' : 'Email me the draw'}
    </button>
  )
}

export default function DrawReminderForm({
  tournamentId,
  tournamentName,
  signupHref,
}: {
  tournamentId: string
  /** Used in the copy so the promise names the thing they asked about. */
  tournamentName: string
  signupHref: string
}) {
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setError(null)
    const email = String(formData.get('email') ?? '')
    const result = await subscribeToDrawReminder({ tournamentId, email })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
    try {
      // Which page earns the address is the question worth answering here —
      // the same reason TrackedCTA carries a `location`.
      if (posthog.__loaded) {
        posthog.capture('draw_reminder_subscribed', { location: 'edition', tournamentId })
      }
    } catch {
      // Analytics must never break a conversion that already succeeded.
    }
  }

  return (
    <div className="mt-5 pt-5 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
      {saved ? (
        <>
          <p
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.05rem',
              letterSpacing: '-0.01em',
              marginBottom: '0.35rem',
            }}
          >
            Done — we&apos;ll email you the moment it lands. ✓
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            That is the only email you&apos;ll get from us. With a free account you
            get every draw, plus points, a global ranking and leagues with friends.
          </p>
        </>
      ) : (
        <>
          <h3
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.05rem',
              letterSpacing: '-0.01em',
              marginBottom: '0.35rem',
            }}
          >
            Get the draw the day it&apos;s out
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
            Leave your email and we&apos;ll tell you the moment the {tournamentName} bracket
            is published — one email, nothing else.
          </p>

          <form action={handleSubmit} className="flex flex-col sm:flex-row gap-2">
            <label htmlFor="draw-reminder-email" className="sr-only">Your email</label>
            <input
              id="draw-reminder-email"
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

      <div className="mt-5 pt-5 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          {saved
            ? 'An account keeps every bracket you make, all season.'
            : 'Or create an account and get told about every draw, not just this one — plus points, a global ranking and leagues with friends.'}
        </p>
        <a
          href={signupHref}
          className="inline-block w-full sm:w-auto text-center px-5 py-3 text-sm font-medium rounded-sm hover:opacity-90"
          style={
            saved
              ? { background: 'var(--court)', color: 'white', textDecoration: 'none' }
              : {
                  background: 'transparent',
                  color: 'var(--court)',
                  border: '1px solid var(--court)',
                  textDecoration: 'none',
                }
          }
        >
          Create a free account →
        </a>
      </div>
    </div>
  )
}
