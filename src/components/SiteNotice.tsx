'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import posthog from 'posthog-js'
import TrackedCTA from './TrackedCTA'

/**
 * A slim, dismissible announcement bar.
 *
 * The first reusable one in the app. Until now every banner here was welded to
 * its own feature — the cookie bar, the account-deletion warning inside Nav,
 * the locked-picks strip in BracketPredictor — so a fourth one meant a fourth
 * hand-rolled bar with its own idea of padding, tap targets and dismissal.
 *
 * Visibility is NOT decided here. The server decides, and this renders only
 * when the answer is yes. That is the whole reason this component can be dumb:
 * mounted inside Nav, whose routes all resolve auth from cookies already, the
 * dismissal cookie is free to read server-side. ConsentBanner has to do the
 * opposite dance — useSyncExternalStore against document.cookie — purely
 * because it lives in the root layout, where one cookies() call would opt the
 * entire static marketing site out of static rendering. Same problem, and the
 * mount point is what makes the difference.
 *
 * The payoff is that there is no flash: someone who dismissed this never
 * receives the markup, and someone who has not gets it in the first byte
 * rather than watching the page jump when React hydrates.
 */

/** Same lifetime as a major's news cycle. Renewed per edition by the cookie name. */
const DISMISS_MAX_AGE = 90 * 24 * 60 * 60

export type NoticeAccent = {
  base: string
  soft: string
  ink: string
}

export default function SiteNotice({
  kicker,
  headline,
  cta,
  secondary,
  accent,
  dismissCookieName,
  canPersistDismissal,
  hidePathPrefixes = [],
}: {
  /** Mono, uppercase, leads the bar. Keep it to a couple of words. */
  kicker: string
  /** One sentence. This is a bar, not a paragraph. */
  headline: string
  /** The action the notice exists for. Tracked, so it is answerable later. */
  cta: { href: string; label: string; location: string }
  /** Optional lower-commitment escape hatch. */
  secondary?: { href: string; label: string }
  accent: NoticeAccent
  dismissCookieName: string
  /**
   * Whether a dismissal may be written to the device at all.
   *
   * Computed server-side from the same consent state middleware uses. A notice
   * dismissal is not strictly necessary storage — it exists for comfort, not to
   * deliver the service — so under `canStore = false` it does not get written,
   * and the dismissal degrades to this page view only. Better a bar that comes
   * back for the minority who declined than a cookie set without consent, which
   * is the failure that actually carries a penalty.
   */
  canPersistDismissal: boolean
  /**
   * Routes where the notice would be redundant or in the way — the slam's own
   * landing page, the bracket itself, the flows in the middle of converting
   * someone. Matched as prefixes.
   */
  hidePathPrefixes?: string[]
}) {
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null
  if (pathname && hidePathPrefixes.some(prefix => pathname.startsWith(prefix))) return null

  function handleDismiss() {
    // React state first, unconditionally. The cookie is an optimisation for the
    // next page load; the click has to be honoured on this one either way.
    setDismissed(true)

    if (canPersistDismissal) {
      const secure = window.location.protocol === 'https:' ? '; secure' : ''
      document.cookie = `${dismissCookieName}=1; path=/; max-age=${DISMISS_MAX_AGE}; samesite=lax${secure}`
    }

    try {
      // PostHog no-ops without a key; __loaded keeps this from throwing in an
      // unconfigured environment, same guard as every other capture site.
      if (posthog.__loaded) {
        posthog.capture('site_notice_dismissed', { notice: dismissCookieName })
      }
    } catch {
      // Analytics must never break a dismiss button.
    }
  }

  return (
    <div
      // A region, not an alert. aria-live would interrupt a screen reader
      // mid-sentence on every navigation to announce a marketing bar, which is
      // not what that role is for.
      role="region"
      aria-label={kicker}
      className="border-b"
      style={{ background: accent.soft, borderColor: accent.base }}
    >
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-2.5 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
        <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
          <span
            className="whitespace-nowrap"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.65rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: accent.ink,
              fontWeight: 600,
            }}
          >
            {kicker}
          </span>
          <span style={{ fontSize: '0.85rem', color: 'var(--ink)', lineHeight: 1.5 }}>
            {headline}
          </span>
        </div>

        {/* Controls stay on one row at every width. At 375px the bar is already
            two lines tall with the headline wrapping; stacking the buttons as
            well pushed it past 120px, which is a third of the viewport spent on
            an announcement above the nav the page actually needs. */}
        <div className="flex items-center gap-2 shrink-0">
          <TrackedCTA
            href={cta.href}
            location={cta.location}
            className="inline-flex items-center justify-center min-h-[36px] px-3.5 text-xs font-medium rounded-sm hover:opacity-90 whitespace-nowrap"
            style={{ background: accent.base, color: 'white', textDecoration: 'none' }}
          >
            {cta.label}
          </TrackedCTA>

          {secondary && (
            <Link
              href={secondary.href}
              className="hidden sm:inline-flex items-center justify-center min-h-[36px] px-2 text-xs whitespace-nowrap"
              style={{ color: accent.ink, textDecoration: 'underline' }}
            >
              {secondary.label}
            </Link>
          )}

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss this notice"
            // 36px rather than the 44px used for primary controls. The tap
            // target guidance is about the actions people are trying to hit;
            // an oversized dismiss sitting beside the CTA competes with it,
            // and a mis-tap here costs the notice, not the user.
            className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-sm hover:opacity-70"
            style={{ color: accent.ink, fontSize: '1rem', lineHeight: 1, background: 'transparent' }}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
