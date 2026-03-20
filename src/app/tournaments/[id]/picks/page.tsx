import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

export default async function AllPicksPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Public page — fetch tournament with admin client
  const admin = createAdminClient()
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, name, tour, category, status')
    .eq('id', id)
    .single()

  if (!tournament) notFound()

  // Picks only visible once tournament is in_progress or completed
  const picksVisible = tournament.status === 'in_progress' || tournament.status === 'completed'

  const [{ data: predictions }, profile] = await Promise.all([
    picksVisible
      ? admin
          .from('predictions')
          .select('id, user_id, points_earned, users(username)')
          .eq('tournament_id', id)
          .is('challenge_id', null)
          .order('points_earned', { ascending: false })
      : Promise.resolve({ data: [] }),
    user
      ? supabase.from('users').select('username, ranking_points').eq('id', user.id).single().then(r => r.data)
      : Promise.resolve(null),
  ])

  const items = (predictions ?? []) as any[]

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" userId={user?.id} />

      <div className="max-w-2xl mx-auto px-4 md:px-8 py-10">

        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/tournaments" style={{ color: 'var(--muted)' }}>Tournaments</Link>
          <span>/</span>
          <Link href={`/tournaments/${id}`} style={{ color: 'var(--muted)' }}>{(tournament as any).name}</Link>
          <span>/</span>
          <span>All picks</span>
        </div>

        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            All picks
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            {(tournament as any).name}
          </p>
        </div>

        {!picksVisible ? (
          <div className="bg-white rounded-sm border py-16 px-8 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'var(--ink)', marginBottom: '0.5rem' }}>
              Picks hidden until play begins
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              Everyone&apos;s brackets will be revealed once the tournament is underway.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-sm border py-16 px-8 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'var(--ink)', marginBottom: '0.5rem' }}>
              No predictions yet
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              No one has locked in their picks for this tournament.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
            <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
              <div className="col-span-1" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>#</div>
              <div className="col-span-7" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>PLAYER</div>
              <div className="col-span-2 text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>PTS</div>
              <div className="col-span-2" />
            </div>

            {items.map((p: any, i: number) => {
              const username = p.users?.username ?? 'Unknown'
              const isMe = user && p.user_id === user.id
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
              return (
                <div
                  key={p.id}
                  className="grid grid-cols-12 px-5 py-4 border-b last:border-0 items-center"
                  style={{ borderColor: 'var(--chalk-dim)', background: isMe ? '#f5faf0' : 'white' }}
                >
                  <div className="col-span-1 flex items-center">
                    {medal
                      ? <span style={{ fontSize: '1rem' }}>{medal}</span>
                      : <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{i + 1}</span>
                    }
                  </div>
                  <div className="col-span-7 flex items-center gap-2 min-w-0">
                    <Link href={`/profile/${username}`} style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: isMe ? 'var(--court)' : 'var(--ink)', textDecoration: 'none' }}>
                      {username}
                    </Link>
                    {isMe && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--court)', background: '#eaf3de', padding: '1px 6px', borderRadius: '2px', flexShrink: 0 }}>
                        you
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 text-right">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: (p.points_earned ?? 0) > 0 ? 'var(--ink)' : 'var(--muted)' }}>
                      {p.points_earned ?? 0}
                    </span>
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <Link href={`/tournaments/${id}/picks/${username}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', textDecoration: 'none' }}>
                      View →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-6 text-center">
          <Link href={`/tournaments/${id}`} style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            ← Back to tournament
          </Link>
        </div>
      </div>
    </main>
  )
}
