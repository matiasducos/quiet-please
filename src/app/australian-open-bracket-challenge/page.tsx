import type { Metadata } from 'next'
import SlamLanding from '@/components/slams/SlamLanding'
import { getSlam } from '@/lib/slams/config'
import { getSlamEditions } from '@/lib/slams/data'
import { buildSlamMetadata } from '@/lib/slams/metadata'

const config = getSlam('australian-open')

export const metadata: Metadata = buildSlamMetadata(config)
// Freshness comes from the `tournament-list` / `tournament-detail` tags that
// getSlamEditions() and getSeriesHub() carry, not from this window — every
// writer that changes a draw or a status busts them. The hour is a backstop.
//
// It reads 300 below but the built route was regenerating every 60 SECONDS:
// Next takes the shortest revalidate of any cache the render touched, and
// SlamLanding calls getOnNowTournaments(), which was a 60s cache. That is
// fixed at the source (see LIST_BACKSTOP in lib/tournaments/cached.ts); this
// value now actually governs.
export const revalidate = 3600

export default async function AustralianOpenBracketChallengePage() {
  const editions = await getSlamEditions(config)
  return <SlamLanding config={config} editions={editions} />
}
