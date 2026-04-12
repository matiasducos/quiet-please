import Link from 'next/link'
import CountryFlag from '@/components/CountryFlag'
import { formatPoints } from '@/lib/utils/format'

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

const SURFACE_COLORS = {
  clay:  { bg: '#fdf2ed', text: '#993C1D', label: 'Clay' },
  grass: { bg: '#edf7f0', text: '#1a6b3c', label: 'Grass' },
  hard:  { bg: '#edf2fb', text: '#185FA5', label: 'Hard' },
} as const

export type TournamentInfo = {
  id?: string
  name: string
  tour: string
  category: string
  surface: string | null
  location: string | null
  flag_emoji: string | null
  starts_at: string | null
  ends_at: string | null
  status: string
}

export type PlayerResult = {
  user_id: string
  username: string
  country?: string | null
  points: number
  correct_picks: number
  total_picks: number
  streak_power: number
  isMe: boolean
}

function formatDateRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt) return '—'
  const start = new Date(startsAt)
  const year = start.getFullYear()
  if (!endsAt || endsAt === startsAt) return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const end = new Date(endsAt)
  if (start.getMonth() === end.getMonth()) {
    const month = start.toLocaleDateString('en-GB', { month: 'short' })
    return `${start.getDate()} – ${end.getDate()} ${month}, ${year}`
  }
  const s = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const e = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${s} – ${e}, ${year}`
}

export default function TournamentResultsTable({ tournament, players }: { tournament: TournamentInfo; players: PlayerResult[] }) {
  const tierKey = `${tournament.tour}|${tournament.category}`
  const tier = TIER[tierKey] ?? { label: tournament.tour, bg: '#4a5568', text: '#fff' }
  const surface = SURFACE_COLORS[(tournament.surface as keyof typeof SURFACE_COLORS) ?? 'hard']
  const dateRange = formatDateRange(tournament.starts_at, tournament.ends_at)
  const isLive = tournament.status === 'in_progress'

  const headerContent = (
    <>
      <div style={{ background: tier.bg, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: tier.text, fontWeight: 600 }}>
          {tier.label}
        </span>
        <div className="flex items-center gap-2">
          {isLive && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', background: '#dc2626', color: '#fff', padding: '2px 8px', borderRadius: '2px', letterSpacing: '0.06em' }}>
              LIVE
            </span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', background: 'rgba(255,255,255,0.18)', color: tier.text, padding: '2px 7px', borderRadius: '2px', letterSpacing: '0.06em' }}>
            {tournament.status === 'completed' ? 'Completed' : tournament.status === 'in_progress' ? 'In progress' : 'Upcoming'}
          </span>
        </div>
      </div>
      <div style={{ padding: '16px 18px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.01em', color: 'var(--ink)', lineHeight: 1.2 }}>
          {tournament.flag_emoji && <span style={{ marginRight: '8px' }}>{tournament.flag_emoji}</span>}
          {tournament.location ?? tournament.name}
        </h2>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span>{tournament.location ? tournament.name : ''}</span>
          {tournament.location && <span>·</span>}
          <span>{dateRange}</span>
          <span
            style={{
              display: 'inline-block', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              background: surface.bg, color: surface.text, padding: '2px 8px', borderRadius: '2px',
            }}
          >
            {surface.label}
          </span>
        </div>
      </div>
    </>
  )

  return (
    <div>
      {/* Tournament header */}
      {tournament.id ? (
        <Link
          href={`/tournaments/${tournament.id}`}
          className="block bg-white rounded-sm border overflow-hidden mb-6 tournament-card"
          style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
        >
          {headerContent}
        </Link>
      ) : (
        <div className="bg-white rounded-sm border overflow-hidden mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          {headerContent}
        </div>
      )}

      {/* Results table */}
      <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="overflow-x-auto">
        <div className="min-w-[600px]">
        <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
          <div className="col-span-1" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>RANK</div>
          <div className="col-span-4" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>PLAYER</div>
          <div className="col-span-2 text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>ACCURACY</div>
          <div className="col-span-1 text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>RATE</div>
          <div className="col-span-2 text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }} title="How much streak multipliers boost this player's points. 1.0x = no bonus, 2.0x = double from streaks.">STREAK POWER</div>
          <div className="col-span-2 text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>POINTS</div>
        </div>

        {players.length === 0 ? (
          <div className="px-5 py-12 text-center" style={{ color: 'var(--muted)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>No results yet</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Points will appear once matches are scored.</p>
          </div>
        ) : (
          players.map((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
            const accuracy = p.total_picks > 0 ? `${p.correct_picks}/${p.total_picks}` : '—'
            const rate = p.total_picks > 0 ? `${Math.round((p.correct_picks / p.total_picks) * 100)}%` : '—'
            return (
              <div key={p.user_id} className="grid grid-cols-12 px-5 py-4 border-b last:border-0"
                style={{ borderColor: 'var(--chalk-dim)', background: p.isMe ? '#edf4fc' : 'white' }}>
                <div className="col-span-1 flex items-center">
                  {medal ? <span style={{ fontSize: '1rem' }}>{medal}</span>
                    : <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{i + 1}</span>}
                </div>
                <div className="col-span-4 flex items-center gap-2">
                  <Link href={`/profile/${p.username}`} style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: p.isMe ? '#1e4e8c' : 'var(--ink)', textDecoration: 'none' }}>{p.username}</Link>
                  {p.country && <CountryFlag country={p.country} size={14} />}
                  {p.isMe && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#1e4e8c', background: '#dbeafe', padding: '1px 6px', borderRadius: '2px' }}>you</span>}
                </div>
                <div className="col-span-2 flex items-center justify-end">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{accuracy}</span>
                </div>
                <div className="col-span-1 flex items-center justify-end">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>{rate}</span>
                </div>
                <div className="col-span-2 flex items-center justify-end" title="How much streak multipliers boost this player's points. 1.0x = no bonus, 2.0x = double from streaks.">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: p.streak_power >= 1.5 ? '#166534' : 'var(--muted)' }}>
                    {p.streak_power.toFixed(1)}x
                  </span>
                </div>
                <div className="col-span-2 flex items-center justify-end">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: p.points > 0 ? 'var(--court)' : 'var(--muted)', fontWeight: 500 }}>
                    {p.points > 0 ? `+${formatPoints(p.points)}` : '0'}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
      </div>
      </div>
    </div>
  )
}
