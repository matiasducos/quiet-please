import { getUnreadLeagueIds } from '@/lib/leagues/unread'
import LeagueUnreadDot from './LeagueUnreadDot'

/**
 * Server wrapper that fetches the unread set so the dot is right in the first
 * paint, mirroring ChatBubbleIconServer. The client component then keeps it
 * live off the shared store.
 *
 * Both nav placements render one of these, and the leagues list renders more.
 * They cost one query between them: getUnreadLeagueIds is React.cache()'d, so
 * every call in a render tree resolves the same promise.
 */
export default async function LeagueUnreadDotServer({
  leagueId,
  size,
  className,
}: {
  leagueId?: string
  size?: number
  className?: string
}) {
  const ids = await getUnreadLeagueIds()
  return <LeagueUnreadDot initialIds={ids} leagueId={leagueId} size={size} className={className} />
}
