'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { initPostHog } from '@/lib/posthog/client'

/**
 * PostHog init + pageview tracking. Renders nothing.
 *
 * Deliberately takes no children, and that is the whole point of the shape.
 * useSearchParams() forces the component into a Suspense boundary, and this
 * used to wrap {children} in layout.tsx — which put a Suspense boundary around
 * the entire app.
 *
 * That boundary silently broke every 404 in the product. notFound() works by
 * throwing, and Next can only translate that throw into a 404 status if it
 * reaches the document root; a Suspense boundary in between catches it and
 * renders the not-found UI *inside* the boundary instead, leaving the response
 * at 200. Nineteen call sites were affected, so every bogus tournament, league
 * and challenge URL answered "200 OK, real page" — see the note in layout.tsx.
 *
 * Keeping this childless means the boundary wraps only the two hooks that need
 * it, and the page tree stays on the direct path from throw to root.
 */
export default function PostHogPageviews() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initialized = useRef(false)

  // Initialize on mount + capture first pageview
  useEffect(() => {
    if (!initialized.current) {
      initPostHog()
      initialized.current = true
    }
  }, [])

  // Track page views on route changes (including initial)
  useEffect(() => {
    if (!pathname) return
    // Wait a tick for PostHog to finish loading on first render
    const timeout = setTimeout(() => {
      if (!posthog.__loaded) return
      const url = searchParams.toString()
        ? `${pathname}?${searchParams.toString()}`
        : pathname
      posthog.capture('$pageview', { $current_url: url })
    }, 100)
    return () => clearTimeout(timeout)
  }, [pathname, searchParams])

  return null
}
