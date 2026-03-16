import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentProfile } = await supabase
    .from('users')
    .select('username, total_points')
    .eq('id', user.id)
    .single()

  const { data: profile } = await supabase
    .from('users')
    .select('id, username, total_points, created_at')
    .eq('username', username)
    .single()

  if (!profile) {
    return (
      <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        <Nav username={currentProfile?.username} points={currentProfile?.total_points ?? 0} />
        <div className="max-w-3xl mx-auto px-8 py-20 text-center">
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '1rem' }}>404</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '1.5rem' }}>Player not found</h1>
          <Link href="/leaderboard" style={{ color: 'var(--court)', fontSize: '0.9rem' }}>← Back to leaderboard</Link>
        </div>
      </main>
    )
  }

  // Global rank: number of players with strictly more points, + 1
  const { count: usersAhead } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gt('total_points', profile.total_points)

  const globalRank = (usersAhead ?? 0) + 1

  // Locked predictions with tournament info
  const { data: predictions } = await supabase
    .from('predictions')
    .select('id, points_earned, created_at, tournaments(id, name, tour, category, starts_at)')
    .eq('user_id', profile.id)
    .eq('is_locked', true)
    .order('created_at', { ascending: false })

  const tournamentsCount = predictions?.length ?? 0
  const hitRate = tournamentsCount > 0
    ? Math.round(((predictions?.filter(p => (p.points_earned ?? 0) > 0).length ?? 0) / tournamentsCount) * 100)
    : 0

  const isOwnProfile = user.id === profile.id
  const memberSince = new Date(profile.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={currentProfile?.username} points={currentProfile?.total_points ?? 0} />

      <div className="max-w-3xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="mb-8">
          <Link href="/leaderboard" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.05em', textDecoration: 'none' }}>
            ← Leaderboard
          </Link>
          <div className="flex items-end justify-between mt-4">
            <div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                {profile.username}
                {isOwnProfile && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--court)', background: '#eaf3de', padding: '2px 8px', borderRadius: '2px', marginLeft: '0.75rem', verticalAlign: 'middle' }}>
                    you
                  </span>
                )}
              </h1>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.4rem', fontFamily: 'var(--font-mono)' }}>
                Member since {memberSince}
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-10">
          {[
            { label: 'Total points', value: profile.total_points },
            { label: 'Global rank', value: `#${globalRank}` },
            { label: 'Tournaments', value: tournamentsCount },
            { label: 'Hit rate', value: tournamentsCount > 0 ? `${hitRate}%` : '—' },
          ].map((stat, i) => (
            <div key={i} className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                {stat.label}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', letterSpacing: '-0.02em' }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Predictions list */}
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
            Predictions
          </h2>

          {!predictions || predictions.length === 0 ? (
            <div className="bg-white rounded-sm border px-6 py-12 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--muted)' }}>No predictions yet</p>
              {isOwnProfile && (
                <Link href="/tournaments" style={{ fontSize: '0.85rem', color: 'var(--court)', marginTop: '0.5rem', display: 'inline-block' }}>
                  Browse tournaments →
                </Link>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
                <div className="col-span-7" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>TOURNAMENT</div>
                <div className="col-span-2 text-center" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>TOUR</div>
                <div className="col-span-3 text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>POINTS</div>
              </div>
              {predictions.map(p => {
                const t = p.tournaments as any
                const pts = p.points_earned ?? 0
                return (
                  <Link
                    key={p.id}
                    href={`/tournaments/${t?.id}`}
                    className="grid grid-cols-12 px-5 py-4 border-b last:border-0 tournament-card"
                    style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
                  >
                    <div className="col-span-7 flex items-center">
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>
                        {t?.name ?? '—'}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-center">
                      <span className="px-2 py-0.5 text-xs rounded-sm" style={{
                        background: t?.tour === 'WTA' ? '#fbeaf0' : '#e6f1fb',
                        color: t?.tour === 'WTA' ? '#993556' : '#185FA5',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {t?.tour ?? '—'}
                      </span>
                    </div>
                    <div className="col-span-3 flex items-center justify-end">
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.9rem',
                        color: pts > 0 ? 'var(--court)' : 'var(--muted)',
                        fontWeight: pts > 0 ? 500 : 400,
                      }}>
                        {pts > 0 ? `+${pts}` : '0'}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
