import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentCard from '@/components/TournamentCard'

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params     = await searchParams
  const activeTour = params.tour === 'WTA' ? 'WTA' : 'ATP'

  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('*')
    .eq('tour', activeTour)
    .order('starts_at', { ascending: true })

  const { data: profile } = await supabase
    .from('users')
    .select('username, total_points')
    .eq('id', user.id)
    .single()

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.total_points ?? 0} activePage="tournaments" />

      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Tournaments
            </h1>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              Pick your bracket before the draw closes.
            </p>
          </div>

          {/* ATP / WTA toggle */}
          <div className="flex rounded-sm overflow-hidden border" style={{ borderColor: 'var(--chalk-dim)' }}>
            {['ATP', 'WTA'].map(tour => (
              <Link
                key={tour}
                href={`/tournaments?tour=${tour}`}
                className="px-6 py-2 text-sm font-medium transition-colors"
                style={{
                  background: activeTour === tour ? 'var(--court)' : 'white',
                  color: activeTour === tour ? 'white' : 'var(--muted)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.05em',
                }}
              >
                {tour}
              </Link>
            ))}
          </div>
        </div>

        {!tournaments || tournaments.length === 0 ? (
          <div className="text-center py-24" style={{ color: 'var(--muted)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>No tournaments yet</p>
            <p style={{ fontSize: '0.875rem' }}>Check back soon — the calendar syncs automatically.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tournaments.map(t => (
              <TournamentCard key={t.id} t={t} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
