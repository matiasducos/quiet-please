'use client'

import Link from 'next/link'
import posthog from 'posthog-js'

/**
 * A Link that records which call-to-action someone actually clicked.
 *
 * The homepage is a server component and should stay one — this is a thin
 * client wrapper so a single link can be interactive without turning the whole
 * page into a client bundle.
 *
 * `location` is the point of the whole thing: several CTAs on the page all
 * lead to /signup, so a bare pageview on /signup cannot tell you which piece
 * of the page is doing the persuading. That is exactly the question worth
 * answering before spending on traffic.
 */
export default function TrackedCTA({
  href,
  location,
  className,
  style,
  children,
}: {
  href: string
  /** Stable identifier for where on the page this CTA sits, e.g. 'hero'. */
  location: string
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  function handleClick() {
    try {
      // PostHog no-ops without NEXT_PUBLIC_POSTHOG_KEY; __loaded keeps this
      // from throwing in an unconfigured environment.
      if (!posthog.__loaded) return
      posthog.capture('cta_clicked', { location, href })
    } catch {
      // Never let analytics stop a navigation.
    }
  }

  return (
    <Link href={href} className={className} style={style} onClick={handleClick}>
      {children}
    </Link>
  )
}
