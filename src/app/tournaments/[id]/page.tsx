import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import type { Database } from '@/types/database'
import Nav from '@/components/Nav'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']

// ── Shared style maps (mirrors TournamentCard) ────────────────────────────
const TIER: Record<string, { label: string; bg: string; text: string }> = {
  'ATP|grand_slam':   { label: 'Grand Slam',   bg: '#1a1a2e', text: '#fff' },
  'ATP|masters_1000': { label: 'Masters 1000', bg: '#185FA5', text: '#fff' },
  'ATP|500':          { label: 'ATP 500',       bg: '#1e7a5e', text: '#fff' },
  'ATP|250':          { label: 'ATP 250',       bg: '#4a5568', text: '#fff' },
  'WTA|grand_slam':   { label: 'Grand Slam',   bg: '#1a1a2e', text: '#fff' },
  'WTA|masters_1000': { label: 'WTA 1000',     bg: '#7c2d7c', text: '#fff' },
  'WTA|500':          { label: 'WTA 500',       bg: '#993556', text: '#fff' },
  'WTA|250':          { label: 'WTA 250',       bg: '#4a5568', text: '#fff' },
}

const SURFACE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  clay:  { bg: '#fdf2ed', text: '#993C1D', label: 'Clay' },
  grass: { bg: '#edf7f0', text: '#1a6b3c', label: 'Grass' },
  hard:  { bg: '#edf2fb', text: '#185FA5', label: 'Hard' },
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  upcoming:               { bg: '#f1efe8', text: '#5F5E5A', label: 'Upcoming' },
  accepting_predictions:  { bg: '#eaf3de', text: '#27500A', label: 'Predictions open' },
  in_progress:            { bg: '#faeeda', text: '#633806', label: 'In progress' },
  completed:              { bg: '#f1efe8', text: '#5F5E5A', label: 'Completed' },
}

function formatDateRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt) return '—'
  const start = new Date(startsAt)
  const year  = start.getFullYear()
  if (!endsAt || endsAt === startsAt) {
    return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  }
  const end = new Date(endsAt)
  if (start.getMonth() === end.getMonth()) {
    const month = start.toLocaleDateString('en-GB', { month: 'long' })
    return `${start.getDate()} – ${end.getDate()} ${month}, ${year}`
  }
  const s = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const e = end.toLocaleDateString('en-GB',   { day: 'numeric', month: 'short' })
  return `${s} – ${e}, ${year}`
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
    .select('id, picks, is_locked, points_earned, is_practice')
    .eq('tournament_id', id)
    .eq('user_id', user.id)
    .single()

  const { data: profile } = await supabase
    .from('users')
    .select('username, total_points')
    .eq('id', user.id)
    .single()

  const tierKey = `${tournament.tour}|${tournament.category}`
  const tier    = TIER[tierKey] ?? { label: tournament.tour, bg: '#4a5568', text: '#fff' }
  const surface = SURFACE_COLORS[tournament.surface ?? 'hard']
  const status  = STATUS_STYLES[tournament.status ?? 'upcoming']

  const canPredict  = tournament.status === 'accepting_predictions' && !prediction?.is_locked
  const canPractice = tournament.status === 'completed' && !!(draw?.bracket_data) && !prediction
  const hasDraw     = draw && draw.bracket_data

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.total_points ?? 0} activePage="tournaments" />

      <div className="max-w-4xl mx-auto px-8 py-10">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-8" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/tournaments" style={{ color: 'var(--muted)' }}>Tournaments</Link>
          <span>/</span>
          <span style={{ color: 'var(--ink)' }}>{tournament.tour}</span>
        </div>

        {/* ── Header card ─────────────────────────────────────────────── */}
        <div className="rounded-sm border bg-white overflow-hidden mb-10" style={{ borderColor: 'var(--chalk-dim)' }}>

          {/* Tier stripe */}
          <div
            style={{
              background: tier.bg,
              padding: '10px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: tier.text,
                fontWeight: 600,
              }}
            >
              {tier.label}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
                letterSpacing: '0.06em',
                background: status.bg,
                color: status.text,
                padding: '3px 9px',
                borderRadius: '2px',
              }}
            >
              {status.label}
            </span>
          </div>

          {/* Body */}
          <div style={{ padding: '24px 20px 20px' }}>

            {/* Flag + location + date */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {(tournament.flag_emoji || tournament.location) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {tournament.flag_emoji && (
                    <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>{tournament.flag_emoji}</span>
                  )}
                  {tournament.location && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.03em' }}>
                      {tournament.location}
                    </span>
                  )}
                </div>
              )}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.03em' }}>
                {formatDateRange(tournament.starts_at, tournament.ends_at)}
              </span>
            </div>

            {/* Tournament name */}
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '16px' }}>
              {tournament.name}
            </h1>

            {/* Meta row: surface + picks-close */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  background: surface.bg,
                  color: surface.text,
                  padding: '4px 10px',
                  borderRadius: '2px',
                }}
              >
                {surface.label}
              </span>

              {tournament.draw_close_at && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                    PICKS CLOSE
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>
                    {formatDate(tournament.draw_close_at)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Main content grid ─────────────────────────────────────────── */}
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
              ) : canPractice ? (
                <div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                    This tournament is over. Practice your bracket against the actual results to see how many points you would have earned.
                  </p>
                  <Link
                    href={`/tournaments/${tournament.id}/predict`}
                    className="inline-block px-6 py-3 text-white text-sm font-medium rounded-sm hover:opacity-90"
                    style={{ background: '#7c2d7c' }}
                  >
                    Practice picks →
                  </Link>
                </div>
              ) : prediction?.is_locked ? (
                <div className="py-6 text-center">
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.04em' }}>
                    Your picks are locked — check the prediction card for your score.
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

          {/* Right — prediction status + points */}
          <div className="col-span-1 flex flex-col gap-4">

            {/* Prediction card */}
            <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
                Your prediction
              </h3>

              {prediction ? (
                <div>
                  {prediction.is_practice && (
                    <div className="mb-3 px-2.5 py-1 rounded-sm inline-flex items-center" style={{ background: '#f3e8ff' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em', color: '#7c2d7c', fontWeight: 600 }}>
                        PRACTICE
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Status</span>
                    <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: prediction.is_locked ? '#993C1D' : '#1a6b3c' }}>
                      {prediction.is_locked ? 'Scored' : 'In progress'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {prediction.is_practice ? 'Practice score' : 'Points earned'}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                      {prediction.points_earned ?? 0} pts
                    </span>
                  </div>
                  {canPredict && (
                    <Link href={`/tournaments/${id}/predict`} className="block w-full py-2.5 text-sm font-medium text-white text-center rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
                      Edit picks
                    </Link>
                  )}
                </div>
              ) : canPractice ? (
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                    This tournament is over. Practice your bracket to see how many points you would have earned — no real points awarded.
                  </p>
                  <Link href={`/tournaments/${id}/predict`} className="block w-full py-2.5 text-sm font-medium text-white text-center rounded-sm hover:opacity-90" style={{ background: '#7c2d7c' }}>
                    Practice picks
                  </Link>
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
                { round: 'Winner',      pts: tournament.category === 'grand_slam' ? 2000 : tournament.category === 'masters_1000' ? 1000 : tournament.category === '500' ? 500  : 250 },
                { round: 'Final',       pts: tournament.category === 'grand_slam' ? 1200 : tournament.category === 'masters_1000' ? 600  : tournament.category === '500' ? 150  : 80  },
                { round: 'Semifinal',   pts: tournament.category === 'grand_slam' ? 720  : tournament.category === 'masters_1000' ? 360  : tournament.category === '500' ? 90   : 45  },
                { round: 'Quarterfinal',pts: tournament.category === 'grand_slam' ? 360  : tournament.category === 'masters_1000' ? 180  : tournament.category === '500' ? 60   : 29  },
                { round: 'R16',         pts: tournament.category === 'grand_slam' ? 180  : tournament.category === 'masters_1000' ? 90   : tournament.category === '500' ? 30   : 13  },
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
