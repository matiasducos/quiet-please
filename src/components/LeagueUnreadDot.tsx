'use client'

import { useUnreadLeagues } from '@/lib/leagues/unread-store'

/**
 * The red dot for unread league chat.
 *
 * One component for all three placements. Pass `leagueId` to ask about one
 * league (a row in the leagues list, the Chat tab); omit it to ask "any league
 * at all", which is what the nav needs.
 *
 * `initialIds` is the server-rendered set. It is the full array rather than a
 * boolean even for the nav dot, because the store answers in league ids and a
 * boolean could not be reconciled with it — the nav would have to guess whether
 * a live set that lost one league still counts as "any".
 */
export default function LeagueUnreadDot({
  initialIds,
  leagueId,
  size = 7,
  className,
}: {
  initialIds: string[]
  leagueId?: string
  size?: number
  className?: string
}) {
  const unread = useUnreadLeagues(initialIds)
  const show = leagueId ? unread.includes(leagueId) : unread.length > 0

  if (!show) return null

  return (
    <span
      className={className}
      // aria-hidden with a sibling label would be the usual move, but this dot
      // always sits inside a link that already names its destination, and a
      // second announcement of "Leagues, new messages, Leagues" is worse than
      // the title. role="status" is wrong too: it is not live, it is a property
      // of the link.
      title="New messages"
      style={{
        display: 'inline-block',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        // Same red as the DM badge in ChatBubbleIcon. Two different reds for
        // "something is unread" in one nav would read as two different states.
        background: '#e8120c',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    />
  )
}
