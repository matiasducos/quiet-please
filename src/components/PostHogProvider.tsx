'use client'

import { useEffect } from 'react'
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

  // Initialize on mount
  useEffect(() => {
    initPostHog()
  }, [])

  // Track page views on route changes
  useEffect(() => {
    if (!pathname || !posthog.__loaded) return
    const url = searchParams.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname
    posthog.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams])

  return <>{children}</>
}
