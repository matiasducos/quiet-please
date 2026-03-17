import Link from 'next/link'

// ── Tier stripe: tour + category → brand colour + display label ────────────
const TIER: Record<string, { label: string; bg: string; text: string }> = {
  'ATP|grand_slam':   { label: 'Grand Slam',    bg: '#1a1a2e', text: '#fff' },
  'ATP|masters_1000': { label: 'Masters 1000',  bg: '#185FA5', text: '#fff' },
  'ATP|500':          { label: 'ATP 500',        bg: '#1e7a5e', text: '#fff' },
  'ATP|250':          { label: 'ATP 250',        bg: '#4a5568', text: '#fff' },
  'WTA|grand_slam':   { label: 'Grand Slam',    bg: '#1a1a2e', text: '#fff' },
  'WTA|masters_1000': { label: 'WTA 1000',      bg: '#7c2d7c', text: '#fff' },
  'WTA|500':          { label: 'WTA 500',        bg: '#993556', text: '#fff' },
  'WTA|250':          { label: 'WTA 250',        bg: '#4a5568', text: '#fff' },
}

const SURFACE_COLORS = {
  clay:  { bg: '#fdf2ed', text: '#993C1D', label: 'Clay' },
  grass: { bg: '#edf7f0', text: '#1a6b3c', label: 'Grass' },
  hard:  { bg: '#edf2fb', text: '#185FA5', label: 'Hard' },
} as const

const STATUS_LABELS: Record<string, string> = {
  upcoming:               'Upcoming',
  accepting_predictions:  'Predict now',
  in_progress:            'In progress',
  completed:              'Completed',
}

// ── Date range helper ─────────────────────────────────────────────────────
// Produces: "20 – 26 Jul, 2026" (same month) or "25 Mar – 5 Apr, 2026" (cross)
function formatDateRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt) return '—'
  const start = new Date(startsAt)
  const year  = start.getFullYear()

  if (!endsAt || endsAt === startsAt) {
    return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const end = new Date(endsAt)
  if (start.getMonth() === end.getMonth()) {
    const month = start.toLocaleDateString('en-GB', { month: 'short' })
    return `${start.getDate()} – ${end.getDate()} ${month}, ${year}`
  }

  const s = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const e = end.toLocaleDateString('en-GB',   { day: 'numeric', month: 'short' })
  return `${s} – ${e}, ${year}`
}

// ── Component ─────────────────────────────────────────────────────────────
export interface TournamentCardData {
  id: string
  name: string
  tour: string
  category: string
  surface: string | null
  starts_at: string | null
  ends_at: string | null
  status: string
  location?: string | null
  flag_emoji?: string | null
}

export default function TournamentCard({ t }: { t: TournamentCardData }) {
  const tierKey = `${t.tour}|${t.category}`
  const tier    = TIER[tierKey] ?? { label: t.tour, bg: '#4a5568', text: '#fff' }
  const surface = SURFACE_COLORS[(t.surface as keyof typeof SURFACE_COLORS) ?? 'hard']
  const statusLabel = STATUS_LABELS[t.status ?? 'upcoming'] ?? 'Upcoming'
  const canPredict  = t.status === 'accepting_predictions'
  const dateRange   = formatDateRange(t.starts_at, t.ends_at)

  // If location is missing but name contains " - City", use the city as a fallback
  const fallbackLocation = !t.location && t.name.includes(' - ')
    ? t.name.split(' - ').pop() ?? null
    : null
  const displayLocation = t.location ?? fallbackLocation

  return (
    <Link
      href={`/tournaments/${t.id}`}
      className="tournament-card block rounded-sm border bg-white overflow-hidden"
      style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
    >
      {/* ── Tier stripe ────────────────────────────────────────────── */}
      <div
        style={{
          background: tier.bg,
          padding: '7px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.65rem',
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
            fontSize: '0.6rem',
            letterSpacing: '0.06em',
            background: 'rgba(255,255,255,0.18)',
            color: tier.text,
            padding: '2px 7px',
            borderRadius: '2px',
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* ── Card body ──────────────────────────────────────────────── */}
      <div style={{ padding: '14px 16px 14px' }}>

        {/* Flag + location (or fallback city parsed from name) */}
        {(t.flag_emoji || displayLocation) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
            {t.flag_emoji && (
              <span style={{ fontSize: '0.95rem', lineHeight: 1 }}>{t.flag_emoji}</span>
            )}
            {displayLocation && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  color: 'var(--muted)',
                  letterSpacing: '0.03em',
                }}
              >
                {displayLocation}
              </span>
            )}
          </div>
        )}

        {/* Date range */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.68rem',
            color: 'var(--muted)',
            letterSpacing: '0.03em',
            marginBottom: '8px',
          }}
        >
          {dateRange}
        </div>

        {/* Tournament name */}
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.2rem',
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            lineHeight: 1.2,
            marginBottom: '12px',
          }}
        >
          {t.name}
        </h2>

        {/* Surface badge */}
        <span
          style={{
            display: 'inline-block',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            background: surface.bg,
            color: surface.text,
            padding: '3px 8px',
            borderRadius: '2px',
          }}
        >
          {surface.label}
        </span>

        {/* CTA when predictions are open */}
        {canPredict && (
          <div
            style={{
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid var(--chalk-dim)',
            }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--court)' }}>
              Make your predictions →
            </span>
          </div>
        )}
      </div>
    </Link>
  )
}
