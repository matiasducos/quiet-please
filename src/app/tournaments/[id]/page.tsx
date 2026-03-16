import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import type { Database } from '@/types/database'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']

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
  accepting_predictions:  { bg: '#eaf3de', text: '#27500A', label: 'Predictions open' },
  in_progress:            { bg: '#faeeda', text: '#633806', label: 'In progress' },
  completed:              { bg: '#f1efe8', text: '#5F5E5A', label: 'Completed' },
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { id } = await params

  const { data } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', id)
    .single()

  if (!data) notFound()
  const tournament = data as TournamentRow

  const { data: draw } = await supabase
    .from('draws')
    .select('bracket_data, synced_at')
    .eq('tournament_id', id)
    .single()

  const { data: prediction } = await supabase
    .from('predictions')
    .select('id, picks, is_locked, points_earned')
    .eq('tournament_id', id)
    .eq('user_id', user.id)
    .single()

  const { data: profile } = await supabase
    .from('users')
    .select('username, total_points')
    .eq('id', user.id)
    .single()

  const surface = SURFACE_COLORS[tournament.surface ?? 'hard']
  const status = STATUS_STYLES[tournament.status ?? 'upcoming']
  const category = CATEGORY_LABELS[tournament.category ?? '250']
  const canPredict = tournament.status === 'accepting_predictions' && !prediction?.is_locked
  const hasDraw = draw && draw.bracket_data

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
        <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>
        <div className="flex items-center gap-6">
          <Link href="/tournaments" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Tournaments</Link>
          <Link href="/leaderboard" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Leaderboard</Link>
          <Link href="/leagues" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Leagues</Link>
          <div className="flex items-center gap-3 ml-4 pl-4 border-l" style={{ borderColor: 'var(--chalk-dim)' }}>
            <Link href={`/profile/${profile?.username}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none' }}>{profile?.username}</Link>
            <span className="score-pill">{profile?.total_points ?? 0} pts</span>
            <form action="/auth/logout" method="post">
              <button type="submit" style={{ fontSize: '0.8rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-8 py-10">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-8" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/tournaments" style={{ color: 'var(--muted)' }}>Tournaments</Link>
          <span>/</span>
          <span style={{ color: 'var(--ink)' }}>{tournament.tour}</span>
        </div>

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-2 py-0.5 rounded-sm text-xs" style={{ background: tournament.tour === 'WTA' ? '#fbeaf0' : '#e6f1fb', color: tournament.tour === 'WTA' ? '#993556' : '#185FA5', fontFamily: 'var(--font-mono)' }}>
              {tournament.tour}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {category}
            </span>
            <span className="px-2 py-0.5 rounded-sm text-xs" style={{ background: status.bg, color: status.text, fontFamily: 'var(--font-mono)' }}>
              {status.label}
            </span>
          </div>

          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '1.5rem' }}>
            {tournament.name}
          </h1>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>SURFACE</span>
              <span className="px-2 py-0.5 rounded-sm text-xs" style={{ background: surface.bg, color: surface.text, fontFamily: 'var(--font-mono)' }}>{surface.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>STARTS</span>
              <span style={{ fontSize: '0.875rem', color: 'var(--ink)' }}>{formatDate(tournament.starts_at)}</span>
            </div>
            {tournament.draw_close_at && (
              <div className="flex items-center gap-2">
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>PICKS CLOSE</span>
                <span style={{ fontSize: '0.875rem', color: 'var(--ink)' }}>{formatDate(tournament.draw_close_at)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="grid grid-cols-3 gap-6">

          {/* Left — draw / bracket */}
          <div className="col-span-2">
            <div className="bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '1rem' }}>
                Draw
              </h2>

              {!hasDraw ? (
                <div className="py-12 text-center">
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                    Draw not yet published
                  </p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    The official draw is usually released a few days before the tournament starts. Check back soon.
                  </p>
                </div>
              ) : (
                  <div>
                    <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
                      The draw is published. Make your picks before it closes.
                    </p>
                    <Link
                      href={`/tournaments/${tournament.id}/predict`}
                      className="inline-block px-6 py-3 text-white text-sm font-medium rounded-sm hover:opacity-90"
                      style={{ background: 'var(--court)' }}
                    >
                      Make predictions →
                    </Link>
                  </div>
              )}
            </div>
          </div>

          {/* Right — prediction status */}
          <div className="col-span-1 flex flex-col gap-4">

            {/* Prediction card */}
            <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
                Your prediction
              </h3>

              {prediction ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Status</span>
                    <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: prediction.is_locked ? '#993C1D' : '#1a6b3c' }}>
                      {prediction.is_locked ? 'Locked' : 'In progress'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Points earned</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{prediction.points_earned}</span>
                  </div>
                  {canPredict && (
                    <Link href={`/tournaments/${id}/predict`} className="block w-full py-2.5 text-sm font-medium text-white text-center rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
                      Edit picks
                    </Link>
                  )}
                </div>
              ) : canPredict ? (
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                    The draw is open. Make your bracket predictions before it closes.
                  </p>
                  <Link href={`/tournaments/${id}/predict`} className="block w-full py-2.5 text-sm font-medium text-white text-center rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
                    Make predictions
                  </Link>
                </div>
              ) : (
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                  {tournament.status === 'upcoming'
                    ? 'Predictions will open when the draw is published.'
                    : tournament.status === 'completed'
                    ? 'This tournament has ended.'
                    : 'Predictions are closed for this tournament.'}
                </p>
              )}
            </div>

            {/* Points breakdown */}
            <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
                Points per round
              </h3>
              {[
                { round: 'Winner', pts: tournament.category === 'grand_slam' ? 2000 : tournament.category === 'masters_1000' ? 1000 : tournament.category === '500' ? 500 : 250 },
                { round: 'Final', pts: tournament.category === 'grand_slam' ? 1200 : tournament.category === 'masters_1000' ? 600 : tournament.category === '500' ? 150 : 80 },
                { round: 'Semifinal', pts: tournament.category === 'grand_slam' ? 720 : tournament.category === 'masters_1000' ? 360 : tournament.category === '500' ? 90 : 45 },
                { round: 'Quarterfinal', pts: tournament.category === 'grand_slam' ? 360 : tournament.category === 'masters_1000' ? 180 : tournament.category === '500' ? 60 : 29 },
                { round: 'R16', pts: tournament.category === 'grand_slam' ? 180 : tournament.category === 'masters_1000' ? 90 : tournament.category === '500' ? 30 : 13 },
              ].map(({ round, pts }) => (
                <div key={round} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{round}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>{pts} pts</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
