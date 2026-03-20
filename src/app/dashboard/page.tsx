import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('username, ranking_points')
    .eq('id', user.id)
    .single()

  const [
    { data: upcomingTournaments },
    { count: predictionCount },
    { count: higherCount },
  ] = await Promise.all([
    supabase
      .from('tournaments')
      .select('id, name, tour, surface, category, starts_at, status')
      .in('status', ['accepting_predictions', 'upcoming'])
      .order('starts_at', { ascending: true })
      .limit(3),
    supabase
      .from('predictions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('challenge_id', null),
    supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gt('total_points', profile?.total_points ?? 0),
  ])

  const globalRank = (higherCount ?? 0) + 1

  const stats = [
    { label: 'Total points', value: profile?.total_points ?? 0 },
    { label: 'Predictions',  value: predictionCount ?? 0 },
    { label: 'Global rank',  value: `#${globalRank}` },
  ]

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} userId={user.id} />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-12">

        <div className="mb-12">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
            Welcome back{profile?.username ? `, ${profile.username}` : ''}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '1rem' }}>Your predictions. Your points. Your season.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-12">
          {stats.map((stat, i) => (
            <div key={i} className="bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                {stat.label}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em' }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Upcoming tournaments */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.01em' }}>Upcoming tournaments</h2>
            <Link href="/tournaments" style={{ fontSize: '0.875rem', color: 'var(--court)' }}>View all →</Link>
          </div>

          {!upcomingTournaments || upcomingTournaments.length === 0 ? (
            <div className="bg-white rounded-sm border py-16 px-8 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--ink)', marginBottom: '0.5rem' }}>
                No upcoming tournaments
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem', maxWidth: '360px', margin: '0 auto 1.5rem' }}>
                The calendar syncs daily. When draws open, they&apos;ll appear here so you can make your picks.
              </p>
              <Link
                href="/tournaments"
                className="inline-block px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
                style={{ background: 'var(--court)' }}
              >
                Browse all tournaments
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {upcomingTournaments.map(t => (
                <Link
                  key={t.id}
                  href={`/tournaments/${t.id}`}
                  className="flex items-center justify-between bg-white rounded-sm border px-6 py-4 tournament-card"
                  style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="px-2 py-0.5 text-xs rounded-sm flex-shrink-0" style={{ background: t.tour === 'WTA' ? '#fbeaf0' : '#e6f1fb', color: t.tour === 'WTA' ? '#993556' : '#185FA5', fontFamily: 'var(--font-mono)' }}>
                      {t.tour}
                    </span>
                    <span className="truncate" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>{t.name}</span>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      {t.starts_at ? new Date(t.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                    </span>
                    {t.status === 'accepting_predictions' && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--court)', fontWeight: 500, whiteSpace: 'nowrap' }}>Predict →</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
