'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { initPostHog } from '@/lib/posthog/client'

/**
 * PostHog client-side provider.
 * - Initializes PostHog on mount
 * - Tracks page views on route changes (App Router compatible)
 * - Wraps the app in layout.tsx
 */
export default function PostHogProvider({ children }: { children: React.ReactNode }) {
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

  return <>{children}</>
}
