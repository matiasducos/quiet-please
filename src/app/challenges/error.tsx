'use client'

import RouteError from '@/components/RouteError'

export default function ChallengesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Failed to load challenges" />
}
