import Link from 'next/link'
import { timeAgo, type ActivityItem } from '@/lib/friends/activity'

const ICON: Record<ActivityItem['type'], string> = {
  tournament: '🎾',
  result: '🏆',
  picks: '🔒',
  points: '⭐',
  league: '👥',
}

/**
 * The blended activity feed, shared by the dashboard preview and /activity.
 *
 * One component rather than one per page: the row carries rules that are not
 * obvious from looking at it — `outcome` describes *the viewer's* bracket and
 * never the row's subject, and result rows deliberately don't link the player
 * name to a profile because it names a tennis player, not a user. A second copy
 * of this markup would lose those within a release.
 *
 * `viewerId` is what turns a username into "You", so it has to be the signed-in
 * user and not the profile being looked at.
 */
export default function ActivityFeed({
  items,
  viewerId,
}: {
  items: ActivityItem[]
  viewerId: string
}) {
  return (
    <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
      {items.map((item, i) => {
        const isMe = item.user_id === viewerId
        // Tints reuse the two the homepage feature grid already uses, so the
        // feed doesn't introduce a third pair of greens and reds. Rows with no
        // outcome (no pick, or a locked one) stay white.
        const outcomeTint =
          item.outcome === 'correct' ? '#edf7f0' : item.outcome === 'wrong' ? '#fef2f2' : undefined
        return (
          <div
            key={`${item.type}-${item.user_id ?? 'system'}-${item.date}-${i}`}
            className="flex items-center gap-3 px-4 md:px-5 py-3 border-b last:border-0"
            style={{ borderColor: 'var(--chalk-dim)', background: outcomeTint }}
          >
            <span style={{ fontSize: '1rem', flexShrink: 0 }}>{ICON[item.type]}</span>
            <div className="flex-1 min-w-0 truncate">
              {item.username ? (
                <>
                  {item.type === 'result' ? (
                    // A result row's subject is the winning player, not a user —
                    // linking it to /profile/<name> would 404.
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--ink)' }}>
                      {item.username}
                    </span>
                  ) : (
                    <Link
                      href={`/profile/${item.username}`}
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '0.9rem',
                        color: isMe ? 'var(--court)' : 'var(--ink)',
                        textDecoration: 'none',
                      }}
                    >
                      {isMe ? 'You' : item.username}
                    </Link>
                  )}
                  {' '}
                </>
              ) : null}
              {item.href ? (
                <Link href={item.href} style={{ fontSize: '0.875rem', color: 'var(--muted)', textDecoration: 'none' }}>
                  {item.label}
                </Link>
              ) : (
                <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>{item.label}</span>
              )}
            </div>
            {/* Shape as well as colour — a red/green tint alone is the one
                pairing colour-blind readers can't separate. */}
            {item.outcome && (
              <span
                aria-label={item.outcome === 'correct' ? 'You predicted this correctly' : 'You predicted this incorrectly'}
                title={item.outcome === 'correct' ? 'You predicted this correctly' : 'You predicted this incorrectly'}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  flexShrink: 0,
                  color: item.outcome === 'correct' ? '#15803d' : '#b91c1c',
                }}
              >
                {item.outcome === 'correct' ? '✓' : '✗'}
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>
              {timeAgo(item.date)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
