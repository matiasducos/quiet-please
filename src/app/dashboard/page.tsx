import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select('username, total_points').eq('id', user.id).single()
  const { data: upcomingTournaments } = await supabase
    .from('tournaments')
    .select('id, name, tour, surface, category, starts_at, status')
    .in('status', ['accepting_predictions', 'upcoming'])
    .order('starts_at', { ascending: true })
    .limit(3)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
        <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>
        <div className="flex items-center gap-6">
          <Link href="/tournaments" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Tournaments</Link>
          <Link href="/leaderboard" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Leaderboard</Link>
          <Link href="/leagues" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Leagues</Link>
          <div className="flex items-center gap-3 ml-4 pl-4 border-l" style={{ borderColor: 'var(--chalk-dim)' }}>
            {profile?.username ? (
              <Link href={`/profile/${profile.username}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none' }}>{profile.username}</Link>
            ) : (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{user.email}</span>
            )}
            <span className="score-pill">{profile?.total_points ?? 0} pts</span>
            <form action="/auth/logout" method="post">
              <button type="submit" style={{ fontSize: '0.8rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </nav>
      <div className="max-w-5xl mx-auto px-8 py-12">
        <div className="mb-12">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
            Welcome back{profile?.username ? `, ${profile.username}` : ''}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '1rem' }}>Your predictions. Your points. Your season.</p>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-12">
          {[
            { label: 'Total points', value: profile?.total_points ?? 0 },
            { label: 'Predictions', value: '—' },
            { label: 'Global rank', value: '—' },
          ].map((stat, i) => (
            <div key={i} className="bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>{stat.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em' }}>{stat.value}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.01em' }}>Upcoming tournaments</h2>
            <Link href="/tournaments" style={{ fontSize: '0.875rem', color: 'var(--court)' }}>View all →</Link>
          </div>
          {!upcomingTournaments || upcomingTournaments.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>No upcoming tournaments right now.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {upcomingTournaments.map(t => (
                <Link key={t.id} href={`/tournaments/${t.id}`} className="flex items-center justify-between bg-white rounded-sm border px-6 py-4 tournament-card" style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}>
                  <div className="flex items-center gap-4">
                    <span className="px-2 py-0.5 text-xs rounded-sm" style={{ background: t.tour === 'WTA' ? '#fbeaf0' : '#e6f1fb', color: t.tour === 'WTA' ? '#993556' : '#185FA5', fontFamily: 'var(--font-mono)' }}>{t.tour}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>{t.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      {t.starts_at ? new Date(t.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                    </span>
                    {t.status === 'accepting_predictions' && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--court)', fontWeight: 500 }}>Predict →</span>
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
