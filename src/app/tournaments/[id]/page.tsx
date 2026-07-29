import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { unstable_cache } from 'next/cache'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Database } from '@/types/database'
import Nav from '@/components/Nav'
import { canPredictForStatus } from '@/lib/app-settings'
import { buildMyTournament } from '@/lib/tennis/my-tournament'
import type { MyTournament, DrawMatch } from '@/lib/tennis/my-tournament'
import MyTournamentPanel from './MyTournamentPanel'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']

type EmbeddedMatch = { external_match_id: string }

type LedgerRow = {
  round: string
  points: number
  prediction_id: string | null
  // point_ledger.match_result_id is many-to-one, so PostgREST returns an object
  // here, but the generated types widen it to an array. Accept both.
  match_results?: EmbeddedMatch | EmbeddedMatch[] | null
}

function embeddedMatchId(row: LedgerRow): string | null {
  const m = row.match_results
  if (!m) return null
  return (Array.isArray(m) ? m[0]?.external_match_id : m.external_match_id) ?? null
}

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

  const [prediction, ledgerRows] = user
    ? await Promise.all([
        supabase
          .from('predictions')
          .select('id, picks, is_fully_locked, points_earned')
          .eq('tournament_id', id)
          .eq('user_id', user.id)
          .is('challenge_id', null)
          .single()
          .then(r => r.data),
        supabase
          .from('point_ledger')
          // match_results is embedded so points can be attributed to the player
          // who won that match — the basis of the per-player breakdown below.
          .select('round, points, prediction_id, match_results(external_match_id)')
          .eq('tournament_id', id)
          .eq('user_id', user.id)
          .then(r => r.data ?? []),
      ])
    : [null, [] as LedgerRow[]]

  // Sum awarded points per internal round (R128, R64, R32, R16, QF, SF, F),
  // scoped to the user's global prediction so challenge points don't leak in.
  // This sum matches predictions.points_earned exactly (see award-points cron).
  const pointsByRound: Record<string, number> = {}
  const pointsByMatch: Record<string, number> = {}
  if (prediction) {
    for (const row of (ledgerRows ?? []) as LedgerRow[]) {
      if (row.prediction_id !== prediction.id) continue
      pointsByRound[row.round] = (pointsByRound[row.round] ?? 0) + row.points
      const ext = embeddedMatchId(row)
      if (ext) pointsByMatch[ext] = (pointsByMatch[ext] ?? 0) + row.points
    }
  }

  // ── "Your tournament" summary ─────────────────────────────────────────────
  // Results are read per-request rather than from the hour-long tournament cache:
  // this panel is the live view of a tournament in progress, so a stale bracket
  // would show players as active after they had already lost.
  let myTournament: MyTournament | null = null
  if (prediction && Object.keys((prediction.picks as Record<string, string>) ?? {}).length > 0) {
    const { data: results, error: resultsErr } = await supabase
      .from('match_results')
      .select('external_match_id, winner_external_id, loser_external_id, round')
      .eq('tournament_id', id)
      .or('score.neq.BYE,score.is.null')

    if (resultsErr) {
      console.error('[tournament] match_results failed:', resultsErr.message)
    } else if (results && results.length > 0) {
      const matches = ((draw?.bracket_data as { matches?: DrawMatch[] })?.matches ?? [])
      const picks = (prediction.picks as Record<string, string>) ?? {}

      // Qualifiers were placeholders when the draw was built, so the snapshot has
      // neither a name nor a country for them. Fall back to the registry for the
      // ids missing either one.
      const fromDraw = new Map<string, { name?: string | null; country?: string | null }>()
      for (const p of matches.flatMap(m => [m?.player1, m?.player2])) {
        if (!p?.externalId) continue
        const prev = fromDraw.get(p.externalId) ?? {}
        fromDraw.set(p.externalId, { name: prev.name ?? p.name, country: prev.country ?? p.country })
      }
      const missing = [...new Set(Object.values(picks))].filter(pid => {
        if (!pid) return false
        const entry = fromDraw.get(pid)
        return !entry?.name || !entry?.country
      })

      let overrides: Record<string, { name?: string | null; country?: string | null }> = {}
      if (missing.length > 0) {
        const { data: registry, error: regErr } = await supabase
          .from('players')
          .select('external_id, name, country')
          .in('external_id', missing.slice(0, 200))
        if (regErr) console.error('[tournament] player registry lookup failed:', regErr.message)
        overrides = Object.fromEntries(
          (registry ?? []).map(p => [p.external_id, { name: p.name, country: p.country }]),
        )
      }

      myTournament = buildMyTournament({ picks, results, matches, pointsByMatch, overrides })
    }
  }

  if (!tournament) notFound()
  const t = tournament as TournamentRow

  const tierKey = `${t.tour}|${t.category}`
  const tier    = TIER[tierKey] ?? { label: t.tour, bg: '#4a5568', text: '#fff' }
  const surface = SURFACE_COLORS[t.surface ?? 'hard']
  const status  = STATUS_STYLES[t.status ?? 'upcoming']

  // Allow predictions based on the current prediction mode setting
  const statusAllowed = await canPredictForStatus(t.status ?? 'upcoming')
  const canPredict = statusAllowed && !prediction?.is_fully_locked
  const hasDraw = draw && draw.bracket_data
  const isLiveOrDone = t.status === 'in_progress' || t.status === 'completed'

  // /predict bounces back here when the status is not predictable and the
  // tournament is not completed (see predict/page.tsx), which happens to a
  // locked in_progress bracket under pre_tournament mode. Send those viewers
  // to the read-only bracket instead so the button never dead-ends.
  const canOpenPredict = statusAllowed || t.status === 'completed'
  const myPicksHref = canOpenPredict || !profile?.username
    ? `/tournaments/${t.id}/predict`
    : `/tournaments/${t.id}/picks/${profile.username}`

  // The predict CTA takes the primary (green) slot whenever it is actionable;
  // otherwise the leaderboard does. Never two greens in the same row.
  const predictCtaLabel = user && canPredict ? (prediction ? 'Edit my picks' : 'Make predictions') : null
  const primary = { background: 'var(--court)', color: 'white', textDecoration: 'none' }
  const secondary = { background: 'white', color: 'var(--ink)', textDecoration: 'none', border: '1px solid var(--chalk-dim)' }
  const btnClass = 'px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-80'

  // Replaces the explanatory copy that used to live in the Draw card.
  const note = !hasDraw
    ? 'Draw not yet published — usually released a few days before play starts.'
    : !prediction && !canPredict
    ? t.status === 'completed'
      ? 'This tournament has ended.'
      : t.status === 'draw_published'
      ? 'The qualifying draw is live. Predictions open once the main draw is published.'
      : t.status === 'in_progress'
      ? 'This tournament is already underway. Predictions are closed.'
      : 'Predictions will open when the draw is published.'
    : null

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" userId={user?.id} />

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
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">

              <div className="flex-1 min-w-0">
                {/* Location (primary heading) */}
                <h1 className="text-3xl md:text-4xl" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '6px' }}>
                  {t.flag_emoji && <span style={{ marginRight: '8px' }}>{t.flag_emoji}</span>}
                  {t.location ?? t.name}
                </h1>

                {/* Tournament name (secondary) + date */}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--muted)', letterSpacing: '0.03em', marginBottom: '16px' }}>
                  {t.location ? <>{t.name} · {formatDateRange(t.starts_at, t.ends_at)}</> : formatDateRange(t.starts_at, t.ends_at)}
                </div>

                {/* Meta row: surface + actions + picks-close */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
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
                      marginRight: '6px',
                    }}
                  >
                    {surface.label}
                  </span>

                  {isLiveOrDone && (
                    <Link
                      href={`/leaderboard/tournaments/${t.id}`}
                      className={btnClass}
                      style={predictCtaLabel ? secondary : primary}
                    >
                      Leaderboard
                    </Link>
                  )}

                  {predictCtaLabel ? (
                    <Link href={`/tournaments/${t.id}/predict`} className={btnClass} style={primary}>
                      {predictCtaLabel}
                    </Link>
                  ) : user && prediction ? (
                    <Link href={myPicksHref} className={btnClass} style={secondary}>
                      See my picks
                    </Link>
                  ) : !user && (statusAllowed || t.status === 'upcoming') ? (
                    <Link href="/login" className={btnClass} style={isLiveOrDone ? secondary : primary}>
                      Sign in to predict
                    </Link>
                  ) : null}

                  {isLiveOrDone && (
                    <>
                      <Link href={`/tournaments/${t.id}/results`} className={btnClass} style={secondary}>
                        Draw results
                      </Link>
                      <Link href={`/tournaments/${t.id}/upcoming`} className={btnClass} style={secondary}>
                        Upcoming matches
                      </Link>
                    </>
                  )}

                  {t.draw_close_at && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '6px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                        PICKS CLOSE
                      </span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>
                        {formatDate(t.draw_close_at)}
                      </span>
                    </div>
                  )}
                </div>

                {note && (
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.02em', lineHeight: 1.5, marginTop: '12px' }}>
                    {note}
                  </p>
                )}
              </div>

              {/* Your prediction — status + points, moved up from the sidebar */}
              {user && prediction && (
                <div
                  className="rounded-sm border px-4 py-3 w-full md:w-auto md:min-w-[200px] flex-shrink-0"
                  style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}
                >
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>
                    Your prediction
                  </div>
                  <div className="flex items-center justify-between gap-6 mb-1.5">
                    <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Status</span>
                    <span style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: prediction.is_fully_locked ? '#993C1D' : '#1a6b3c' }}>
                      {prediction.is_fully_locked ? 'Locked' : 'In progress'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Points earned</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                      {prediction.points_earned ?? 0} pts
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Your tournament ───────────────────────────────────────────── */}
        {myTournament && (
          <MyTournamentPanel data={myTournament} isComplete={t.status === 'completed'} />
        )}

        {/* ── Points breakdown ──────────────────────────────────────────── */}
        <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
            Points per round
          </h3>
          {user && (
            <div className="flex items-center justify-between pb-1.5" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              <span />
              <span className="flex items-center" style={{ gap: '18px' }}>
                <span>Base</span>
                <span style={{ minWidth: '3.5rem', textAlign: 'right' }}>You</span>
              </span>
            </div>
          )}
          {[
            { round: 'Winner',      ledger: 'F',    pts: t.category === 'grand_slam' ? 2000 : t.category === 'masters_1000' ? 1000 : t.category === '500' ? 500  : 250 },
            { round: 'Semifinal',   ledger: 'SF',   pts: t.category === 'grand_slam' ? 720  : t.category === 'masters_1000' ? 360  : t.category === '500' ? 90   : 45  },
            { round: 'Quarterfinal',ledger: 'QF',   pts: t.category === 'grand_slam' ? 360  : t.category === 'masters_1000' ? 180  : t.category === '500' ? 60   : 29  },
            { round: 'R16',         ledger: 'R16',  pts: t.category === 'grand_slam' ? 180  : t.category === 'masters_1000' ? 90   : t.category === '500' ? 30   : 13  },
            { round: 'R32',         ledger: 'R32',  pts: t.category === 'grand_slam' ? 90   : t.category === 'masters_1000' ? 45   : t.category === '500' ? 20   : 6   },
            ...(['grand_slam', 'masters_1000'].includes(t.category) ? [
              { round: 'R64',       ledger: 'R64',  pts: t.category === 'grand_slam' ? 45   : 25 },
            ] : []),
            ...(['grand_slam', 'masters_1000'].includes(t.category) ? [
              { round: 'R128',      ledger: 'R128', pts: t.category === 'grand_slam' ? 10   : 10 },
            ] : []),
          ].map(({ round, ledger, pts }) => {
            const earned = pointsByRound[ledger] ?? 0
            return (
              <div key={round} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{round}</span>
                <span className="flex items-center" style={{ gap: '18px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>
                  <span>{pts} pts</span>
                  {user && (
                    <span style={{ minWidth: '3.5rem', textAlign: 'right', color: earned > 0 ? 'var(--court)' : 'var(--muted)' }}>
                      {earned} pts
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
