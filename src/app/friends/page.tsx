import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { sendFriendRequest, acceptFriendRequest, declineFriendRequest, cancelFriendRequest } from './actions'

export default async function FriendsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; type?: string }>
}) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const { data: friendships } = await admin
    .from('friendships').select('id, requester_id, addressee_id, status, created_at')
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .order('created_at', { ascending: false })

  // Fetch usernames for all involved users
  const otherIds = [...new Set(
    (friendships ?? [])
      .flatMap(f => [f.requester_id, f.addressee_id])
      .filter(id => id !== user.id)
  )]

  let usernames: Record<string, string> = {}
  if (otherIds.length > 0) {
    const { data: users } = await admin
      .from('users')
      .select('id, username')
      .in('id', otherIds)
    usernames = Object.fromEntries((users ?? []).map(u => [u.id, u.username]))
  }

  type FriendRow = { id: string; other_id: string; username: string }
  type RequestRow = { id: string; other_id: string; username: string }

  const accepted: FriendRow[] = (friendships ?? [])
    .filter(f => f.status === 'accepted')
    .map(f => {
      const otherId = f.requester_id === user.id ? f.addressee_id : f.requester_id
      return { id: f.id, other_id: otherId, username: usernames[otherId] ?? 'Unknown' }
    })

  const received: RequestRow[] = (friendships ?? [])
    .filter(f => f.status === 'pending' && f.addressee_id === user.id)
    .map(f => ({ id: f.id, other_id: f.requester_id, username: usernames[f.requester_id] ?? 'Unknown' }))

  const sent: RequestRow[] = (friendships ?? [])
    .filter(f => f.status === 'pending' && f.requester_id === user.id)
    .map(f => ({ id: f.id, other_id: f.addressee_id, username: usernames[f.addressee_id] ?? 'Unknown' }))

  const { msg, type } = await searchParams

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" userId={user.id} />

      <div className="max-w-5xl mx-auto px-8 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/challenges" style={{ color: 'var(--muted)' }}>Challenges</Link>
          <span>/</span>
          <span>Friends</span>
        </div>

        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Friends</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>Add friends to challenge them head-to-head in tournaments.</p>
        </div>

        {/* Message banner */}
        {msg && (
          <div
            className="rounded-sm px-4 py-3 mb-6 text-sm"
            style={{
              background: type === 'success' ? '#eaf3de' : '#fdecea',
              color: type === 'success' ? 'var(--court-dark)' : '#c84b31',
              fontFamily: 'var(--font-mono)',
              border: `1px solid ${type === 'success' ? '#c3dda8' : '#f5c0b8'}`,
            }}
          >
            {decodeURIComponent(msg)}
          </div>
        )}

        {/* Add friend */}
        <div className="bg-white rounded-sm border p-6 mb-8" style={{ borderColor: 'var(--chalk-dim)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '1rem' }}>Add a friend</h2>
          <form action={sendFriendRequest} className="flex gap-3">
            <input type="hidden" name="return_to" value="/friends" />
            <input
              name="username"
              type="text"
              placeholder="Enter username"
              required
              className="flex-1 px-3 py-2 rounded-sm border text-sm"
              style={{ borderColor: 'var(--chalk-dim)', fontFamily: 'var(--font-mono)', outline: 'none' }}
            />
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90"
              style={{ background: 'var(--court)' }}
            >
              Send request
            </button>
          </form>
        </div>

        {/* Incoming requests */}
        {received.length > 0 && (
          <div className="mb-8">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
              Pending requests
            </h2>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {received.map(req => (
                <div
                  key={req.id}
                  className="flex items-center justify-between px-5 py-4 border-b last:border-0"
                  style={{ borderColor: 'var(--chalk-dim)' }}
                >
                  <Link
                    href={`/profile/${req.username}`}
                    style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', textDecoration: 'none' }}
                  >
                    {req.username}
                  </Link>
                  <div className="flex gap-2">
                    <form action={acceptFriendRequest}>
                      <input type="hidden" name="friendship_id" value={req.id} />
                      <input type="hidden" name="return_to" value="/friends" />
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs font-medium text-white rounded-sm hover:opacity-90"
                        style={{ background: 'var(--court)' }}
                      >
                        Accept
                      </button>
                    </form>
                    <form action={declineFriendRequest}>
                      <input type="hidden" name="friendship_id" value={req.id} />
                      <input type="hidden" name="return_to" value="/friends" />
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs rounded-sm border"
                        style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white' }}
                      >
                        Decline
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Friends list */}
        <div className="mb-8">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
            Friends ({accepted.length})
          </h2>
          {accepted.length === 0 ? (
            <div className="bg-white rounded-sm border py-12 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>No friends yet. Send a request above to get started.</p>
            </div>
          ) : (
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {accepted.map(f => (
                <div
                  key={f.id}
                  className="flex items-center justify-between px-5 py-4 border-b last:border-0"
                  style={{ borderColor: 'var(--chalk-dim)' }}
                >
                  <Link
                    href={`/profile/${f.username}`}
                    style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', textDecoration: 'none' }}
                  >
                    {f.username}
                  </Link>
                  <Link
                    href={`/challenges/new?friend_id=${f.other_id}`}
                    className="px-3 py-1.5 text-xs font-medium text-white rounded-sm hover:opacity-90"
                    style={{ background: 'var(--court)', textDecoration: 'none' }}
                  >
                    Challenge →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sent pending */}
        {sent.length > 0 && (
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
              Sent requests
            </h2>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {sent.map(req => (
                <div
                  key={req.id}
                  className="flex items-center justify-between px-5 py-4 border-b last:border-0"
                  style={{ borderColor: 'var(--chalk-dim)' }}
                >
                  <Link
                    href={`/profile/${req.username}`}
                    style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', textDecoration: 'none' }}
                  >
                    {req.username}
                  </Link>
                  <form action={cancelFriendRequest}>
                    <input type="hidden" name="friendship_id" value={req.id} />
                    <input type="hidden" name="return_to" value="/friends" />
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-xs rounded-sm border"
                      style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white' }}
                    >
                      Cancel
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
