#!/bin/bash
set -e
mkdir -p src/app/tournaments

cat > src/app/tournaments/page.tsx << 'EOF'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

const SURFACE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  clay:  { bg: '#fdf2ed', text: '#993C1D', label: 'Clay' },
  grass: { bg: '#edf7f0', text: '#1a6b3c', label: 'Grass' },
  hard:  { bg: '#edf2fb', text: '#185FA5', label: 'Hard' },
}

const CATEGORY_LABELS: Record<string, string> = {
  grand_slam:   'Grand Slam',
  masters_1000: 'Masters 1000',
  '500':        'ATP/WTA 500',
  '250':        'ATP/WTA 250',
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  upcoming:               { bg: '#f1efe8', text: '#5F5E5A', label: 'Upcoming' },
  accepting_predictions:  { bg: '#eaf3de', text: '#27500A', label: 'Predict now' },
  in_progress:            { bg: '#faeeda', text: '#633806', label: 'In progress' },
  completed:              { bg: '#f1efe8', text: '#5F5E5A', label: 'Completed' },
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const params = await searchParams
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
      <nav className="flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
        <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>
        <div className="flex items-center gap-6">
          <Link href="/tournaments" style={{ fontSize: '0.875rem', color: 'var(--ink)', fontWeight: 500 }}>Tournaments</Link>
          <Link href="/leaderboard" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Leaderboard</Link>
          <Link href="/leagues" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Leagues</Link>
          <div className="flex items-center gap-3 ml-4 pl-4 border-l" style={{ borderColor: 'var(--chalk-dim)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{profile?.username}</span>
            <span className="score-pill">{profile?.total_points ?? 0} pts</span>
          </div>
        </div>
      </nav>
      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Tournaments</h1>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>Pick your bracket before the draw closes.</p>
          </div>
          <div className="flex rounded-sm overflow-hidden border" style={{ borderColor: 'var(--chalk-dim)' }}>
            {['ATP', 'WTA'].map(tour => (
              <Link key={tour} href={`/tournaments?tour=${tour}`} className="px-6 py-2 text-sm font-medium transition-colors"
                style={{ background: activeTour === tour ? 'var(--court)' : 'white', color: activeTour === tour ? 'white' : 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
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
            {tournaments.map(t => {
              const surface = SURFACE_COLORS[t.surface ?? 'hard']
              const status = STATUS_STYLES[t.status ?? 'upcoming']
              const category = CATEGORY_LABELS[t.category ?? '250']
              const canPredict = t.status === 'accepting_predictions'
              return (
                <Link key={t.id} href={`/tournaments/${t.id}`} className="tournament-card block rounded-sm border bg-white p-6" style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}>
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>{category}</span>
                    <span className="px-2 py-0.5 rounded-sm text-xs font-medium" style={{ background: status.bg, color: status.text, fontFamily: 'var(--font-mono)' }}>{status.label}</span>
                  </div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', color: 'var(--ink)', marginBottom: '0.75rem', lineHeight: 1.2 }}>{t.name}</h2>
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-sm text-xs" style={{ background: surface.bg, color: surface.text, fontFamily: 'var(--font-mono)' }}>{surface.label}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{formatDate(t.starts_at)}</span>
                  </div>
                  {canPredict && (
                    <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
                      <span className="text-sm font-medium" style={{ color: 'var(--court)' }}>Make your predictions →</span>
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
EOF

cat > src/app/dashboard/page.tsx << 'EOF'
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
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{profile?.username ?? user.email}</span>
            <span className="score-pill">{profile?.total_points ?? 0} pts</span>
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
EOF

echo "✅ Tournament pages written"
