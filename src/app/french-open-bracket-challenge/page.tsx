import type { Metadata } from 'next'
import SlamLanding from '@/components/slams/SlamLanding'
import { getSlam } from '@/lib/slams/config'
import { getSlamEditions } from '@/lib/slams/data'
import { buildSlamMetadata } from '@/lib/slams/metadata'

const config = getSlam('french-open')

export const metadata: Metadata = buildSlamMetadata(config)
export const revalidate = 300

export default async function FrenchOpenBracketChallengePage() {
  const editions = await getSlamEditions(config)
  return <SlamLanding config={config} editions={editions} />
}
