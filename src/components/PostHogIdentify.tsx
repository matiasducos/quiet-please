'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'

/**
 * Identifies the current user to PostHog so we can track unique users,
 * see user counts in dashboards, and attach events to real people.
 *
 * Rendered in Nav (which has userId) — only fires when user is authenticated.
 */
export default function PostHogIdentify({
  userId,
  username,
}: {
  userId: string
  username: string
}) {
  useEffect(() => {
    if (!posthog.__loaded) return
    posthog.identify(userId, { username })
  }, [userId, username])

  return null
}
