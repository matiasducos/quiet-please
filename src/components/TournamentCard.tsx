import React from 'react'
import Link from 'next/link'
import type { Highlight } from '@/lib/tournaments/recap-types'

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
  draw_published:         'Draw published',
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
  prediction_count?: number
  challenge_count?: number
  /**
   * End-of-tournament stats, already formatted. Plain data rather than the raw
   * recap payload: this component is rendered by two CLIENT components, and
   * passing formatted lines keeps the formatting logic (and the country table
   * it reads) out of their bundles.
   */
  recap_highlights?: Highlight[]
  /**
   * Where "Full recap →" goes. Carried on the data rather than passed as a
   * prop so it flows through `TournamentsClientList`, which spreads whole
   * tournament objects and would otherwise need the link threaded separately.
   * Absent when no recap is stored, or when the tournament has no series and
   * therefore no canonical edition URL.
   */
  recap_href?: string | null
}

export default function TournamentCard({ t, disableLink, action, footer, predictableStatuses }: { t: TournamentCardData; disableLink?: boolean; action?: React.ReactNode; footer?: React.ReactNode; predictableStatuses?: string[] }) {
  const tierKey = `${t.tour}|${t.category}`
  const tier    = TIER[tierKey] ?? { label: t.tour, bg: '#4a5568', text: '#fff' }
  const surface = SURFACE_COLORS[(t.surface as keyof typeof SURFACE_COLORS) ?? 'hard']
  const statusLabel = STATUS_LABELS[t.status ?? 'upcoming'] ?? 'Upcoming'
  const canPredict  = predictableStatuses
    ? predictableStatuses.includes(t.status)
    : t.status === 'accepting_predictions'
  const isCompleted = t.status === 'completed'
  const dateRange   = formatDateRange(t.starts_at, t.ends_at)

  // If location is missing but name contains " - City", use the city as a fallback
  const fallbackLocation = !t.location && t.name.includes(' - ')
    ? t.name.split(' - ').pop() ?? null
    : null
  const displayLocation = t.location ?? fallbackLocation

  const highlights = t.recap_highlights ?? []
  const hasRecap = isCompleted && highlights.length > 0
  // Only a card that actually shows recap stats sends you to the recap. A
  // completed card with no stats linking to a recap page would be a promise
  // the destination does not keep.
  const recapHref = hasRecap ? t.recap_href ?? null : null

  const Wrapper = disableLink ? 'div' : Link
  const cardBg = isCompleted ? '#f7f5f0' : 'white'
  const cardBorder = isCompleted ? '#e0dbd2' : 'var(--chalk-dim)'
  const wrapperProps = disableLink
    ? { className: 'block rounded-sm border overflow-hidden', style: { borderColor: cardBorder, background: cardBg } }
    // A card showing recap stats links to the recap; everything else keeps the
    // /tournaments/<uuid> redirect to the edition page.
    : { href: recapHref ?? `/tournaments/${t.id}`, className: 'tournament-card block rounded-sm border overflow-hidden', style: { borderColor: cardBorder, background: cardBg, textDecoration: 'none' } }

  return (
    <Wrapper {...wrapperProps as any}>
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

        {/* Location (card heading). h3, not h2: these cards sit inside a
            section whose own h2 is the section title, and promoting city names
            to h2 puts "Los Cabos, Mexico" on the same outline level as the
            page's real section headings. */}
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.2rem',
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            lineHeight: 1.2,
            marginBottom: '2px',
          }}
        >
          {t.flag_emoji && <span style={{ marginRight: '6px' }}>{t.flag_emoji}</span>}
          {displayLocation ?? t.name}
        </h3>

        {/* Tournament name (secondary) + date */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.68rem',
            color: 'var(--muted)',
            letterSpacing: '0.03em',
            marginBottom: '12px',
          }}
        >
          {displayLocation ? <>{t.name} · {dateRange}</> : dateRange}
        </div>

        {/* Surface badge + engagement stats (inline) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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

          {(t.prediction_count ?? 0) + (t.challenge_count ?? 0) > 0 && t.status !== 'upcoming' && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.6rem',
                color: 'var(--muted)',
                letterSpacing: '0.03em',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {(t.prediction_count ?? 0) > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ fontSize: '0.7rem' }}>🎯</span>
                  {t.prediction_count} {t.prediction_count === 1 ? 'prediction' : 'predictions'}
                </span>
              )}
              {(t.prediction_count ?? 0) > 0 && (t.challenge_count ?? 0) > 0 && (
                <span style={{ color: 'var(--chalk-dim)' }}>·</span>
              )}
              {(t.challenge_count ?? 0) > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ fontSize: '0.7rem' }}>⚔️</span>
                  {t.challenge_count} {t.challenge_count === 1 ? 'challenge' : 'challenges'}
                </span>
              )}
            </span>
          )}
        </div>

        {/* ── Recap: what happened, once the tournament is over ───────── */}
        {hasRecap && (
          <div
            style={{
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid var(--chalk-dim)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {highlights.map(h => (
              <div key={h.label}>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.55rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--muted)',
                    marginBottom: '2px',
                  }}
                >
                  {h.label}
                </div>
                {/* Player names are long and the card is 343px wide on a
                    375px screen, so this wraps rather than truncating —
                    a clipped "Carlos Alcar…" reads as a bug. */}
                <div
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    color: 'var(--ink)',
                    lineHeight: 1.3,
                  }}
                >
                  {h.value}
                </div>
                {h.detail && (
                  <div
                    style={{
                      fontSize: '0.68rem',
                      color: 'var(--muted)',
                      lineHeight: 1.4,
                      marginTop: '1px',
                    }}
                  >
                    {h.detail}
                  </div>
                )}
              </div>
            ))}

            {/* A span, not a Link: the whole card is already an anchor, and
                nesting one inside another is invalid HTML that React will
                hydrate into a broken DOM. Callers point the card at the recap
                via the `href` prop instead. */}
            <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--court)' }}>
              Full recap →
            </span>
          </div>
        )}

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

        {/* Full-width footer slot (e.g. the viewer's own standing in this tournament) */}
        {footer && (
          <div
            style={{
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid var(--chalk-dim)',
            }}
          >
            {footer}
          </div>
        )}

        {/* Action slot (e.g. challenge button) */}
        {action && (
          <div
            style={{
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid var(--chalk-dim)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            {action}
          </div>
        )}
      </div>
    </Wrapper>
  )
}
