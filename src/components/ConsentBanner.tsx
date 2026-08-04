'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import {
  CONSENT_COOKIE_NAME,
  CONSENT_REQUIRED_COOKIE_NAME,
  parseConsent,
  type ConsentDecision,
} from '@/lib/consent'
import { applyConsentToPostHog } from '@/lib/posthog/client'

/** Event the footer's "Cookie settings" link dispatches to reopen this. */
export const OPEN_CONSENT_EVENT = 'qp:open-consent'
const CONSENT_CHANGED_EVENT = 'qp:consent-changed'

/**
 * document.cookie hands back the raw, percent-encoded value — unlike the
 * server-side cookie APIs, which decode for you. Missing that meant
 * `granted:1` arrived as `granted%3A1`, parseConsent saw no version
 * separator and returned null, and the banner reappeared on every page for
 * someone who had already accepted.
 */
function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const raw = document.cookie
    .split('; ')
    .find(row => row.startsWith(`${name}=`))
    ?.split('=')[1]
  if (raw === undefined) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Cookie state as an external store rather than useState + useEffect.
 *
 * The values live in document.cookie, which does not exist during SSR, so
 * this is exactly the "browser-only value" shape useSyncExternalStore is for.
 * Doing it with an effect that calls setState is what
 * react-hooks/set-state-in-effect exists to catch, and it would flash the
 * banner for a moment on every load for visitors who already decided.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(CONSENT_CHANGED_EVENT, onChange)
  return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange)
}

/** One string so the primitive comparison in useSyncExternalStore does the right thing. */
function getSnapshot(): string {
  return `${readCookie(CONSENT_REQUIRED_COOKIE_NAME) ?? ''}|${readCookie(CONSENT_COOKIE_NAME) ?? ''}`
}

/** Server render shows nothing — the banner is a client-side decision. */
function getServerSnapshot(): string {
  return '|'
}

export default function ConsentBanner() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [forcedOpen, setForcedOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Subscribing is the effect; the state change happens in the handler, which
  // is why this one is an effect and the cookie read above is not.
  useEffect(() => {
    const open = () => setForcedOpen(true)
    window.addEventListener(OPEN_CONSENT_EVENT, open)
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, open)
  }, [])

  const [requiredFlag, consentRaw] = snapshot.split('|')
  const decision = parseConsent(consentRaw || undefined)

  // Ask when this visitor's region requires it and they have not decided.
  // Outside the EEA/UK nothing is shown, but "Cookie settings" still opens it
  // so anyone anywhere can decline.
  const shouldAsk = requiredFlag === '1' && decision === null
  if (!shouldAsk && !forcedOpen) return null

  async function decide(next: ConsentDecision) {
    setSaving(true)
    try {
      await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: next,
          // The page this was accepted on, so the server can recover the
          // attribution the middleware was not allowed to write.
          url: window.location.href,
          referrer: document.referrer || null,
        }),
      })
    } catch {
      // A failed request must not trap someone behind the banner forever.
      // The cookie simply isn't set and they will be asked again.
    }
    applyConsentToPostHog(next)
    setForcedOpen(false)
    setSaving(false)
    window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT))
  }

  // Both buttons are the same size, the same shape and one click each.
  // Unequal prominence between accept and reject is the most commonly
  // enforced defect in EU cookie banners, so this is a constraint, not a
  // style choice — keep them symmetrical.
  const buttonBase = 'flex-1 md:flex-none inline-flex items-center justify-center min-h-[44px] px-6 text-sm font-medium rounded-sm border whitespace-nowrap'

  return (
    <div
      // A region, not a dialog. role="dialog" sets an expectation of modality
      // — focus trapping, Escape to dismiss — that this bar deliberately does
      // not implement, because you can keep reading and clicking the page
      // behind it.
      role="region"
      aria-label="Cookie choices"
      className="fixed bottom-0 left-0 right-0 z-[100] border-t"
      style={{ background: 'var(--chalk)', borderColor: 'var(--chalk-dim)', boxShadow: '0 -2px 12px rgba(0,0,0,0.06)' }}
    >
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
        {/* Names both categories and what each is for. Vagueness reads as
            safer but is the opposite: consent has to be *informed*, so
            "we use cookies to improve your experience" is weaker ground than
            saying plainly that the optional ones are analytics. The mention
            of changing your choice is not decoration either — withdrawal
            being as easy as consent is a requirement, and this is where
            people look for it. */}
        <p className="flex-1" style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          We use essential cookies to run this site, and optional analytics cookies to understand
          how it&apos;s used. Declining keeps only the essential ones. You can change your choice at any
          time.{' '}
          <Link href="/privacy" style={{ color: 'var(--court)', textDecoration: 'underline' }}>
            Privacy Policy
          </Link>
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => decide('denied')}
            disabled={saving}
            className={`${buttonBase} disabled:opacity-50`}
            style={{ background: 'white', borderColor: 'var(--court)', color: 'var(--court)' }}
          >
            Decline
          </button>
          <button
            onClick={() => decide('granted')}
            disabled={saving}
            className={`${buttonBase} disabled:opacity-50`}
            style={{ background: 'var(--court)', borderColor: 'var(--court)', color: 'white' }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
