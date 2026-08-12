import type { ReactNode } from 'react'
import { DISPLAY, BODY, MONO } from '../fonts'
import type { CardTournament } from '../data'

/**
 * Shared chrome for every social card.
 *
 * Two rules govern everything in this directory, both imposed by Satori:
 *
 *  1. Only flexbox. There is no grid, no float, no table. Any element with more
 *     than one child must say `display: 'flex'` explicitly — Satori does not
 *     inherit the browser's block default and throws if it is missing.
 *  2. Only the four faces loaded in ../fonts.ts. A fontFamily naming anything
 *     else falls back silently, so the card renders in the wrong typeface with
 *     no error to notice.
 */

export type CardSize = 'story' | 'square'

export const DIMENSIONS: Record<CardSize, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
}

export const C = {
  chalk: '#f5f2eb',
  chalkDim: '#e8e3d8',
  court: '#1a6b3c',
  courtDark: '#0f4a29',
  clay: '#c8530a',
  ink: '#0d0d0d',
  muted: '#6b6b6b',
} as const

export { DISPLAY, BODY, MONO }

/**
 * Instagram overlays its own UI on a story: the profile row eats the top ~250px
 * and the reply bar the bottom ~220px. Content inside those bands gets covered
 * on a real phone, so the frame reserves them rather than trusting each template
 * to remember. Square posts are shown whole and only need optical margin.
 */
const SAFE: Record<CardSize, { top: number; bottom: number; x: number }> = {
  story: { top: 250, bottom: 230, x: 80 },
  // The square's bottom is optical margin, not a reserve for someone else's UI,
  // so it is the cheapest space on the card to buy back — and a footer that ends
  // in a rule reads fine closer to the edge than a bare headline would. Story
  // keeps 230: that band is under Instagram's reply bar, and tightening it would
  // put the CTA behind a control rather than merely near an edge.
  square: { top: 72, bottom: 52, x: 72 },
}

export function formatDates(t: CardTournament): string {
  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      : null
  const start = fmt(t.startsAt)
  const end = fmt(t.endsAt)
  if (start && end && start !== end) return `${start} – ${end}`
  return start ?? end ?? ''
}

const CATEGORY_LABEL: Record<string, string> = {
  grand_slam: 'Grand Slam',
  masters_1000: 'Masters 1000',
  '500': 'ATP/WTA 500',
  '250': 'ATP/WTA 250',
}

/**
 * The name as it should read on a card, not as it reads on a contract.
 *
 * Official tour names carry a sponsor clause — "National Bank Open presented by
 * Rogers", "Mifel Tennis Open by Telcel Oppo" — which triples the title length
 * and pushes it to three wrapped lines. Everyone calls these the National Bank
 * Open and the Mifel Open, so the clause is dropped for display only; nothing
 * downstream of this function stores or matches on the result.
 */
export function displayName(name: string): string {
  return name.replace(/\s+(?:presented\s+)?by\s+.+$/i, '').trim() || name
}

/**
 * Satori cannot measure text, so a title that outgrows its box just wraps and
 * blows the layout. Stepping the size by character count is crude but total —
 * every name lands somewhere, and the common short ones keep the full display size.
 */
function titleSize(name: string, story: boolean): number {
  const base = story ? 96 : 76
  if (name.length > 30) return Math.round(base * 0.62)
  if (name.length > 22) return Math.round(base * 0.78)
  return base
}

export function subtitle(t: CardTournament): string {
  return [CATEGORY_LABEL[t.category] ?? t.category, t.surface ? `${t.surface} court` : null, formatDates(t)]
    .filter(Boolean)
    .join('  ·  ')
}

/** Uppercase mono label — the recurring small-type voice across all cards. */
export function Eyebrow({ children, color = C.clay, size = 26 }: { children: ReactNode; color?: string; size?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        fontFamily: MONO,
        fontWeight: 500,
        fontSize: size,
        letterSpacing: size * 0.14,
        textTransform: 'uppercase',
        color,
      }}
    >
      {children}
    </div>
  )
}

export function Rule({ color = C.chalkDim, height = 3 }: { color?: string; height?: number }) {
  return <div style={{ display: 'flex', width: '100%', height, backgroundColor: color }} />
}

export function Frame({
  size,
  eyebrow,
  tournament,
  children,
  cta = 'Play free at quietplease.app',
  ctaLead,
}: {
  size: CardSize
  eyebrow: string
  tournament: CardTournament
  children: ReactNode
  cta?: string
  /**
   * A headline-sized line above the CTA — the ask, set at a size that competes
   * with the card's own content rather than reading as a credit.
   *
   * Only the draw card uses it, and only because that card is the acquisition
   * one: it is the post a stranger sees before they have an account, so the
   * instruction has to be the loudest thing in the footer. Everywhere else the
   * audience already plays and the plain CTA is the right volume.
   *
   * It stays a separate line rather than a bigger `cta` because the row also
   * carries the handle: "Make your picks — quietplease.app" set at 56px runs to
   * ~1000px of a 920px band, and Satori would neither warn nor wrap it usefully.
   * Stacking keeps the widest thing on the row at ~400px.
   */
  ctaLead?: string
}) {
  const s = SAFE[size]
  const story = size === 'story'
  const title = displayName(tournament.name)
  const size_ = titleSize(title, story)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: C.chalk,
        paddingTop: s.top,
        paddingBottom: s.bottom,
        paddingLeft: s.x,
        paddingRight: s.x,
      }}
    >
      {/* Logo only — the wordmark is redundant next to the @quietplease handle
          in the footer, and the mark reads better at size on a phone screen. */}
      <div style={{ display: 'flex' }}>
        <div
          style={{
            display: 'flex',
            width: 108,
            height: 108,
            borderRadius: 26,
            backgroundColor: C.court,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: 60, color: C.chalk }}>QP</div>
        </div>
      </div>

      {/* Headline block */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: story ? 64 : 40 }}>
        <Eyebrow size={story ? 26 : 22}>{eyebrow}</Eyebrow>
        {/* flex-start, not center: a name that wraps to two or three lines would
            otherwise drag the flag down to the middle of the block, stranding it
            inside the title instead of leading it. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 22,
            marginTop: 18,
            fontFamily: DISPLAY,
            fontSize: size_,
            color: C.ink,
            lineHeight: 1.05,
          }}
        >
          {/* The flag is part of how a tournament is named across the app — never drop it. */}
          {tournament.flagEmoji ? (
            <div style={{ display: 'flex', flexShrink: 0 }}>{tournament.flagEmoji}</div>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column' }}>{title}</div>
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 14,
            fontFamily: BODY,
            fontSize: story ? 28 : 24,
            color: C.muted,
          }}
        >
          {subtitle(tournament)}
        </div>
      </div>

      {/* Body — flex:1 so templates fill whatever the headline leaves */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginTop: story ? 56 : 28 }}>
        {children}
      </div>

      {/* Footer — tighter on the square, which has 840px less to spend on the
          same chrome and is the only size where the recap runs out of room. */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: story ? 24 : 16 }}>
        <Rule />
        <div
          style={{
            display: 'flex',
            marginTop: story ? 22 : 16,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: ctaLead ? (story ? 6 : 4) : 0 }}>
            {ctaLead ? (
              <div
                style={{
                  display: 'flex',
                  fontFamily: DISPLAY,
                  fontSize: story ? 56 : 40,
                  color: C.court,
                  lineHeight: 1.05,
                }}
              >
                {ctaLead}
              </div>
            ) : null}
            <div
              style={{
                display: 'flex',
                fontFamily: BODY,
                fontWeight: 700,
                fontSize: story ? 30 : 26,
                color: ctaLead ? C.ink : C.court,
              }}
            >
              {cta}
            </div>
          </div>
          <div style={{ display: 'flex', fontFamily: MONO, fontWeight: 500, fontSize: 24, color: C.muted, letterSpacing: 2 }}>
            @quietplease
          </div>
        </div>
      </div>
    </div>
  )
}
