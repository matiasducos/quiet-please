import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentCard from '@/components/TournamentCard'
import TournamentMonthGroup from '@/components/TournamentMonthGroup'

// Cached — same data for all users, refreshes every hour
const getTournaments = unstable_cache(
  async (tour: string, surface: string) => {
    const supabase = createAdminClient()
    let q = supabase.from('tournaments').select('*').eq('tour', tour).order('starts_at', { ascending: true })
    if (surface !== 'all') q = (q as any).eq('surface', surface)
    const { data } = await q
    return data ?? []
  },
  ['tournament-list'],
  { revalidate: 3600 }
)

const SURFACES = [
  { key: 'all',   label: 'All surfaces' },
  { key: 'clay',  label: 'Clay',  color: '#993C1D', bg: '#fdf2ed' },
  { key: 'grass', label: 'Grass', color: '#1a6b3c', bg: '#edf7f0' },
  { key: 'hard',  label: 'Hard',  color: '#185FA5', bg: '#edf2fb' },
]

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ tour?: string; surface?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const params        = await searchParams
  const activeTour    = params.tour === 'WTA' ? 'WTA' : 'ATP'
  const activeSurface = ['clay', 'grass', 'hard'].includes(params.surface ?? '') ? params.surface! : 'all'

  const [tournaments, profile] = await Promise.all([
    getTournaments(activeTour, activeSurface),
    user
      ? supabase.from('users').select('username, ranking_points').eq('id', user.id).single().then(r => r.data)
      : Promise.resolve(null),
  ])

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" userId={user?.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">

        {/* Header + ATP/WTA toggle */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Tournaments
            </h1>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              Pick your bracket before the draw closes.
            </p>
          </div>

          <div className="flex rounded-sm overflow-hidden border" style={{ borderColor: 'var(--chalk-dim)' }}>
            {['ATP', 'WTA'].map(tour => (
              <Link
                key={tour}
                href={`/tournaments?tour=${tour}${activeSurface !== 'all' ? `&surface=${activeSurface}` : ''}`}
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

        {/* Surface filter chips */}
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {SURFACES.map(s => {
            const active = activeSurface === s.key
            const activeColor = (s as any).color ?? 'var(--ink)'
            const activeBg    = (s as any).bg    ?? 'white'
            return (
              <Link
                key={s.key}
                href={`/tournaments?tour=${activeTour}${s.key !== 'all' ? `&surface=${s.key}` : ''}`}
                className="flex-shrink-0 px-3 py-1.5 text-xs rounded-sm border transition-all"
                style={{
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em',
                  borderColor: active ? activeColor : 'var(--chalk-dim)',
                  background:   active ? activeBg  : 'white',
                  color:         active ? activeColor : 'var(--muted)',
                  fontWeight:    active ? 600 : 400,
                }}
              >
                {s.label}
              </Link>
            )
          })}
        </div>

        {tournaments.length === 0 ? (
          <div className="text-center py-24" style={{ color: 'var(--muted)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>
              No {activeSurface !== 'all' ? `${activeSurface}-court ` : ''}{activeTour} tournaments
            </p>
            <p style={{ fontSize: '0.875rem' }}>
              {activeSurface !== 'all' ? (
                <Link href={`/tournaments?tour=${activeTour}`} style={{ color: 'var(--court)' }}>
                  View all {activeTour} tournaments →
                </Link>
              ) : (
                'Check back soon — the calendar syncs automatically.'
              )}
            </p>
          </div>
        ) : (() => {
          // ── Group tournaments by calendar month ──────────────────────────
          // Key format: "YYYY-MM" (0-based month, zero-padded) — sorts correctly lexicographically
          const monthMap = new Map<string, { label: string; list: typeof tournaments }>()
          for (const t of tournaments) {
            let key: string
            let label: string
            if (t.starts_at) {
              const d = new Date(t.starts_at)
              key   = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
              label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
            } else {
              key   = '9999-99'
              label = 'Date TBC'
            }
            if (!monthMap.has(key)) monthMap.set(key, { label, list: [] })
            monthMap.get(key)!.list.push(t)
          }

          const now        = new Date()
          // Current month key — months are 0-indexed so match the same format used above
          const currentKey = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`

          const groups = [...monthMap.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, { label, list }]) => ({ key, label, list }))

          return (
            <>
              {groups.map(group => (
                <TournamentMonthGroup
                  key={group.key}
                  month={group.label}
                  count={group.list.length}
                  defaultOpen={group.key >= currentKey}
                >
                  {group.list.map((t: any) => (
                    <TournamentCard key={t.id} t={t} />
                  ))}
                </TournamentMonthGroup>
              ))}
            </>
          )
        })()}
      </div>
    </main>
  )
}
