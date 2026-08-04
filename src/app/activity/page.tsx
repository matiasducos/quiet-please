import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import ActivityFeed from '@/components/ActivityFeed'
import { getNavProfile } from '@/lib/supabase/profile'
import { getActivity } from '@/lib/friends/activity'

export const metadata: Metadata = { title: 'Activity' }

/**
 * The full activity feed — where "See all activities" on the dashboard goes.
 *
 * Same blended source as the dashboard preview (you + friends + tournaments),
 * just without the truncation. It deliberately does not paginate: `getActivity`
 * reads a fixed 30-day window, and within that window a feed is short enough to
 * scroll. Pagination would mean holding a cursor across five separate event
 * queries that are merged and re-sorted in memory.
 */
const FEED_LIMIT = 100

// Every row is per-viewer (the outcome ticks are the reader's own bracket), so
// there is nothing shareable to cache.
export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const activity = await getActivity(user.id, FEED_LIMIT)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav
        deletionRequestedAt={profile?.deletion_requested_at}
        username={profile?.username}
        points={profile?.ranking_points ?? 0}
        userId={user.id}
      />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <nav
          className="flex items-center gap-2 mb-6"
          style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
        >
          <Link href="/dashboard" style={{ color: 'var(--muted)' }}>Dashboard</Link>
          <span>/</span>
          <span style={{ color: 'var(--ink)' }}>Activity</span>
        </nav>

        <h1
          className="text-3xl md:text-4xl"
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', marginBottom: '0.4rem' }}
        >
          Activity
        </h1>
        {/* Says "last 30 days" because that is what the feed actually covers —
            the window is fixed in getActivity(). Calling it "everything" would
            be a promise the query does not keep. */}
        <p style={{ color: 'var(--muted)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
          You, your friends and the tournaments you have entered — last 30 days.
        </p>

        {activity.length > 0 ? (
          <ActivityFeed items={activity} viewerId={user.id} />
        ) : (
          <div className="bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontSize: '0.95rem', color: 'var(--muted)', lineHeight: 1.6 }}>
              Nothing in the last 30 days yet. Fill in a bracket or{' '}
              <Link href="/friends" style={{ color: 'var(--court)' }}>add a friend</Link>{' '}
              and results, points and locked picks will show up here.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
