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
  square: { top: 72, bottom: 72, x: 72 },
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
}: {
  size: CardSize
  eyebrow: string
  tournament: CardTournament
  children: ReactNode
  cta?: string
}) {
  const s = SAFE[size]
  const story = size === 'story'
  const titleSize = story ? 96 : 76

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
      {/* Wordmark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div
          style={{
            display: 'flex',
            width: 62,
            height: 62,
            borderRadius: 16,
            backgroundColor: C.court,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: 34, color: C.chalk }}>QP</div>
        </div>
        <div
          style={{
            display: 'flex',
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: 24,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: C.muted,
          }}
        >
          Quiet Please
        </div>
      </div>

      {/* Headline block */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: story ? 64 : 40 }}>
        <Eyebrow size={story ? 26 : 22}>{eyebrow}</Eyebrow>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            marginTop: 18,
            fontFamily: DISPLAY,
            fontSize: titleSize,
            color: C.ink,
            lineHeight: 1.05,
          }}
        >
          {/* The flag is part of how a tournament is named across the app — never drop it. */}
          {tournament.flagEmoji ? <div style={{ display: 'flex' }}>{tournament.flagEmoji}</div> : null}
          <div style={{ display: 'flex' }}>{tournament.name}</div>
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
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginTop: story ? 56 : 36 }}>
        {children}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 24 }}>
        <Rule />
        <div
          style={{
            display: 'flex',
            marginTop: 22,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', fontFamily: BODY, fontWeight: 700, fontSize: story ? 30 : 26, color: C.court }}>
            {cta}
          </div>
          <div style={{ display: 'flex', fontFamily: MONO, fontWeight: 500, fontSize: 24, color: C.muted, letterSpacing: 2 }}>
            @quietplease
          </div>
        </div>
      </div>
    </div>
  )
}
