'use client'

import { OPEN_CONSENT_EVENT } from '@/components/ConsentBanner'

/**
 * Reopens the consent banner.
 *
 * Withdrawal has to be as easy as granting was — one click, always reachable.
 * That is why this sits in the footer next to Terms and Privacy rather than
 * inside account settings: the people most likely to want it are logged out.
 *
 * A button, not a link: it changes state on this page and goes nowhere.
 */
export default function CookieSettingsLink() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}
      className="inline-flex items-center min-h-[44px] px-2"
      style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
    >
      Cookie settings
    </button>
  )
}
