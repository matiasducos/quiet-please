import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { unstable_cache } from 'next/cache'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Database } from '@/types/database'
import Nav from '@/components/Nav'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']

// ── ISR cache — same for all users, refreshes every hour ──────────────────
// Tags allow sync-draws to call revalidateTag(`tournament:${id}`) the moment
// a new draw is saved, so users see the bracket immediately rather than
// waiting up to an hour for the ISR window to expire.
const getTournamentDetail = unstable_cache(
  async (id: string) => {
    const supabase = createAdminClient()
    const [{ data: tournament }, { data: draw }] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', id).single(),
      supabase.from('draws').select('bracket_data, synced_at').eq('tournament_id', id).single(),
    ])
    return { tournament, draw }
  },
  ['tournament-detail'],
  { revalidate: 3600, tags: ['tournament-detail'] }
)

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
  draw_published:         { bg: '#edf2fb', text: '#185FA5', label: 'Draw published' },
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
  const { id } = await params

  // Public data (cached) + auth (per-request, no redirect)
  const supabase = await createClient()

  const [{ user, profile }, { tournament, draw }] = await Promise.all([
    getNavProfile(),
    getTournamentDetail(id),
  ])

  const prediction = user
    ? await supabase
        .from('predictions')
        .select('id, picks, is_fully_locked, points_earned')
        .eq('tournament_id', id)
        .eq('user_id', user.id)
        .is('challenge_id', null)
        .single()
        .then(r => r.data)
    : null

  if (!tournament) notFound()
  const t = tournament as TournamentRow

  const tierKey = `${t.tour}|${t.category}`
  const tier    = TIER[tierKey] ?? { label: t.tour, bg: '#4a5568', text: '#fff' }
  const surface = SURFACE_COLORS[t.surface ?? 'hard']
  const status  = STATUS_STYLES[t.status ?? 'upcoming']

  // Allow predictions for accepting_predictions AND in_progress (for unplayed matches)
  const canPredict = (t.status === 'accepting_predictions' || t.status === 'in_progress') &&
    !prediction?.is_fully_locked
  const hasDraw = draw && draw.bracket_data

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" userId={user?.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-8" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/tournaments" style={{ color: 'var(--muted)' }}>Tournaments</Link>
          <span>/</span>
          <span style={{ color: 'var(--ink)' }}>{t.tour}</span>
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

            {/* Location (primary heading) */}
            <h1 className="text-3xl md:text-4xl" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '6px' }}>
              {t.flag_emoji && <span style={{ marginRight: '8px' }}>{t.flag_emoji}</span>}
              {t.location ?? t.name}
            </h1>

            {/* Tournament name (secondary) + date */}
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--muted)', letterSpacing: '0.03em', marginBottom: '16px' }}>
              {t.location ? <>{t.name} · {formatDateRange(t.starts_at, t.ends_at)}</> : formatDateRange(t.starts_at, t.ends_at)}
            </div>

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

              {t.draw_close_at && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                    PICKS CLOSE
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>
                    {formatDate(t.draw_close_at)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Main content grid ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Left — draw / bracket */}
          <div className="col-span-1 md:col-span-2">
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
              ) : user && prediction?.is_fully_locked ? (
                <div className="py-6 text-center">
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.04em', marginBottom: '1rem' }}>
                    Your bracket is locked.
                  </p>
                  <div className="flex flex-col items-center gap-3">
                    <Link
                      href={`/tournaments/${id}/predict`}
                      className="inline-block px-5 py-2 text-sm font-medium rounded-sm hover:opacity-90"
                      style={{ background: 'var(--court)', color: 'white' }}
                    >
                      View your picks →
                    </Link>
                    {(t.status === 'in_progress' || t.status === 'completed') && (
                      <Link
                        href={`/tournaments/${id}/picks`}
                        style={{ fontSize: '0.8rem', color: 'var(--muted)' }}
                      >
                        See all picks →
                      </Link>
                    )}
                  </div>
                </div>
              ) : user && canPredict ? (
                <div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
                    {t.status === 'in_progress'
                      ? 'The tournament is underway. You can still predict unplayed matches.'
                      : 'The draw is published. Make your picks before the first match starts.'}
                  </p>
                  <Link
                    href={`/tournaments/${t.id}/predict`}
                    className="inline-block px-6 py-3 text-white text-sm font-medium rounded-sm hover:opacity-90"
                    style={{ background: 'var(--court)' }}
                  >
                    {prediction ? 'Edit predictions →' : 'Make predictions →'}
                  </Link>
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1rem' }}>
                    {t.status === 'accepting_predictions'
                      ? 'Sign in to make your picks.'
                      : t.status === 'draw_published'
                      ? 'The qualifying draw is live. Sign in — predictions open once the main draw is published.'
                      : t.status === 'completed'
                      ? 'This tournament has ended.'
                      : t.status === 'in_progress' && !user
                      ? 'Sign in to predict unplayed matches.'
                      : 'Sign in to be notified when predictions open.'}
                  </p>
                  <div className="flex flex-col items-center gap-3">
                    {(t.status === 'accepting_predictions' || t.status === 'in_progress' || t.status === 'upcoming') && !user && (
                      <Link
                        href="/login"
                        className="inline-block px-6 py-2.5 text-sm font-medium rounded-sm hover:opacity-90"
                        style={{ background: 'var(--court)', color: 'white' }}
                      >
                        Sign in to predict →
                      </Link>
                    )}
                    {(t.status === 'in_progress' || t.status === 'completed') && (
                      <Link
                        href={`/tournaments/${id}/picks`}
                        style={{ fontSize: '0.875rem', color: 'var(--court)' }}
                      >
                        See all picks →
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right — prediction status + points */}
          <div className="col-span-1 flex flex-col gap-4">

            {/* Prediction card */}
            <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
                {user ? 'Your prediction' : 'Predict the draw'}
              </h3>

              {!user ? (
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                    {t.status === 'accepting_predictions' || t.status === 'in_progress'
                      ? 'The draw is open. Sign in to pick your bracket and earn points.'
                      : t.status === 'draw_published'
                      ? 'The qualifying draw is live. Predictions open when the main draw is published.'
                      : t.status === 'upcoming'
                      ? 'Sign in to be notified when predictions open.'
                      : 'Sign in to track your predictions and compare with friends.'}
                  </p>
                  <Link
                    href="/login"
                    className="block w-full py-2.5 text-sm font-medium text-white text-center rounded-sm hover:opacity-90"
                    style={{ background: 'var(--court)' }}
                  >
                    Sign in
                  </Link>
                </div>
              ) : prediction ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Status</span>
                    <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: prediction.is_fully_locked ? '#993C1D' : '#1a6b3c' }}>
                      {prediction.is_fully_locked ? 'Locked' : 'In progress'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Points earned</span>
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
              ) : canPredict ? (
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                    {t.status === 'in_progress'
                      ? 'The tournament is underway. You can still predict unplayed matches.'
                      : 'The draw is open. Make your bracket predictions before the first match starts.'}
                  </p>
                  <Link href={`/tournaments/${id}/predict`} className="block w-full py-2.5 text-sm font-medium text-white text-center rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
                    Make predictions
                  </Link>
                </div>
              ) : (
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                  {t.status === 'draw_published'
                    ? 'The qualifying draw is live. Predictions will open once the main draw is published.'
                    : t.status === 'upcoming'
                    ? 'Predictions will open when the draw is published.'
                    : t.status === 'completed'
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
                { round: 'Winner',      pts: t.category === 'grand_slam' ? 2000 : t.category === 'masters_1000' ? 1000 : t.category === '500' ? 500  : 250 },
                { round: 'Final',       pts: t.category === 'grand_slam' ? 1200 : t.category === 'masters_1000' ? 600  : t.category === '500' ? 150  : 80  },
                { round: 'Semifinal',   pts: t.category === 'grand_slam' ? 720  : t.category === 'masters_1000' ? 360  : t.category === '500' ? 90   : 45  },
                { round: 'Quarterfinal',pts: t.category === 'grand_slam' ? 360  : t.category === 'masters_1000' ? 180  : t.category === '500' ? 60   : 29  },
                { round: 'R16',         pts: t.category === 'grand_slam' ? 180  : t.category === 'masters_1000' ? 90   : t.category === '500' ? 30   : 13  },
                { round: 'R32',         pts: t.category === 'grand_slam' ? 90   : t.category === 'masters_1000' ? 45   : t.category === '500' ? 20   : 6   },
                ...(['grand_slam', 'masters_1000'].includes(t.category) ? [
                  { round: 'R64',       pts: t.category === 'grand_slam' ? 45   : 25 },
                ] : []),
                ...(['grand_slam', 'masters_1000'].includes(t.category) ? [
                  { round: 'R128',      pts: t.category === 'grand_slam' ? 10   : 10 },
                ] : []),
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
