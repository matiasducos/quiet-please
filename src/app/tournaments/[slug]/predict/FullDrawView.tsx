'use client'

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import CountryFlag from '@/components/CountryFlag'

/**
 * The whole draw as one tree — the alternative to BracketPredictor's
 * round-by-round list.
 *
 * Deliberately presentational. Every rule about who sits in a slot, what a pick
 * is worth and whether it may change lives in BracketPredictor and is handed in
 * already resolved (`cardFor`), and every click goes back out through
 * `onPlayerClick` into the same `pickWinner` / `clearPick` the list uses. Two
 * views over one set of rules, so they cannot disagree about a bracket.
 *
 * Layout is plain arithmetic, not flow: every card has the same fixed size, a
 * first-round card sits at its index, and every later card sits at the midpoint
 * of the two cards that feed it. Zoom scales that one layer with a transform,
 * so nothing reflows while zooming.
 *
 * Scrolling is native on purpose. The tree scrolls sideways inside its own box
 * and the page scrolls down as usual, which gets touch momentum, trackpads and
 * keyboard scrolling for free and never fights the browser over a gesture.
 */

export interface FullDrawPlayer {
  externalId: string
  name: string
  country: string
  seed?: number
}

export interface FullDrawSide {
  player: FullDrawPlayer | null
  /** Background wash — the same outcome colours the list view uses. */
  bg: string
  /** Hatched: here on the user's own unconfirmed pick. */
  projected: boolean
  clickable: boolean
  /** Short outcome mark on the right: ✓, ✗, a dot for a live pick. */
  mark?: { text: string; color: string }
  title?: string
}

export interface FullDrawCard {
  sides: [FullDrawSide, FullDrawSide]
  isBye: boolean
  /** Short status for the header strip: LOCKED, PLAYED, ×3, … */
  badge?: { text: string; color: string; bg?: string; title?: string }
}

export interface FullDrawMatch {
  matchId: string
  round: string
}

/** Scroll the tree to a round, and optionally bring one match on screen. */
export interface FullDrawFocus {
  round: string
  matchId?: string
  /** Bumped per request so asking for the same place twice still scrolls. */
  seq: number
}

const WIDE_QUERY = '(min-width: 640px)'

function subscribeWide(onChange: () => void) {
  const mq = window.matchMedia(WIDE_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/**
 * Sizes per breakpoint.
 *
 * Narrow is sized so two columns fill a 375px phone exactly: 343px of content
 * after the page's px-4 gutter is 160 + 23 + 160. Two rounds side by side is the
 * point of this view on a phone — you can see where a winner goes next, which
 * the one-round list never shows.
 */
const SIZES = {
  narrow: { cardW: 160, colGap: 23, nameSize: '0.72rem' },
  wide:   { cardW: 232, colGap: 44, nameSize: '0.8rem' },
}

const HEADER_H = 16
const ROW_H = 25
/** Two rows, the header strip and the three 1px borders between them. */
const CARD_H = HEADER_H + ROW_H * 2 + 3
const V_GAP = 10
const TITLE_H = 30

export default function FullDrawView({
  rounds,
  matchesByRound,
  feeders,
  roundLabels,
  cardFor,
  onPlayerClick,
  onOpenMatch,
  zoom,
  focus,
  onVisibleRoundChange,
}: {
  /** Rounds to draw, in order. A scoped challenge passes only its own. */
  rounds: string[]
  /** Draw order within each round — the same order the feed map is built on. */
  matchesByRound: Record<string, FullDrawMatch[]>
  /** matchId → the matches whose winners fill its two slots. */
  feeders: Record<string, { player1Feeder?: string; player2Feeder?: string }>
  roundLabels: Record<string, string>
  cardFor: (matchId: string) => FullDrawCard
  onPlayerClick: (matchId: string, playerExternalId: string) => void
  /** Open the match in the list view, where locking and STATS live. */
  onOpenMatch: (matchId: string, round: string) => void
  zoom: number
  focus: FullDrawFocus | null
  onVisibleRoundChange: (round: string) => void
}) {
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    // Mobile first: the server renders the phone layout.
    () => false,
  )
  const { cardW, colGap, nameSize } = wide ? SIZES.wide : SIZES.narrow
  const colPitch = cardW + colGap

  // ── Positions ───────────────────────────────────────────────────────────
  // One forward pass: a card's y is known once both of its feeders are.
  const y: Record<string, number> = {}
  const col: Record<string, number> = {}
  let maxY = 0
  rounds.forEach((round, ri) => {
    const matches = matchesByRound[round] ?? []
    // Spacing for a round whose feeders are not drawn (the first column, or
    // the first in-scope round of a scoped challenge) — the first-round pitch,
    // doubled once per round, so an orphan column still lines up with the tree.
    const pitch = (CARD_H + V_GAP) * (ri === 0 ? 1 : 2 ** ri)
    const offset = ri === 0 ? 0 : (pitch - (CARD_H + V_GAP)) / 2
    matches.forEach((m, i) => {
      col[m.matchId] = ri
      const f = feeders[m.matchId]
      const ys = [f?.player1Feeder, f?.player2Feeder]
        .filter((id): id is string => !!id && y[id] !== undefined)
        .map(id => y[id])
      y[m.matchId] = ys.length > 0
        ? ys.reduce((a, b) => a + b, 0) / ys.length
        : offset + i * pitch
      maxY = Math.max(maxY, y[m.matchId])
    })
  })

  const layoutW = rounds.length * colPitch - colGap
  const layoutH = TITLE_H + maxY + CARD_H

  // ── Scrolling ───────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const lastReported = useRef<string | null>(null)

  /**
   * Keep the round tabs following the column at the left edge, so switching
   * back to the list lands on the round you were looking at. Reported only on
   * change — this runs on every scroll frame.
   */
  const reportVisibleRound = () => {
    const el = scrollRef.current
    if (!el) return
    const idx = Math.min(
      rounds.length - 1,
      Math.max(0, Math.round(el.scrollLeft / zoom / colPitch)),
    )
    const round = rounds[idx]
    if (round && round !== lastReported.current) {
      lastReported.current = round
      onVisibleRoundChange(round)
    }
  }

  /**
   * Zoom around the column you are on. Changing the scale moves every x, so
   * without this a zoom step would slide you into a different round.
   */
  const prevZoom = useRef(zoom)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || prevZoom.current === zoom) return
    el.scrollLeft = el.scrollLeft * (zoom / prevZoom.current)
    prevZoom.current = zoom
  }, [zoom])

  useEffect(() => {
    if (!focus) return
    const el = scrollRef.current
    if (!el) return
    const ri = rounds.indexOf(focus.round)
    if (ri < 0) return
    el.scrollTo({ left: ri * colPitch * zoom, behavior: 'smooth' })
    lastReported.current = focus.round

    if (focus.matchId && y[focus.matchId] !== undefined && layerRef.current) {
      const top = layerRef.current.getBoundingClientRect().top + window.scrollY
      const cardMid = top + (TITLE_H + y[focus.matchId] + CARD_H / 2) * zoom
      window.scrollTo({ top: cardMid - window.innerHeight / 2, behavior: 'smooth' })
    }
    // Keyed on the request alone: re-running on a layout change would yank
    // the reader back to a place they have since scrolled away from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.seq])

  /**
   * Drag to pan, for a mouse. Touch and trackpads already scroll natively, but
   * a plain wheel only scrolls down, and the tree is mostly sideways.
   */
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const el = scrollRef.current
    if (!d || !el) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    d.moved = true
    el.scrollLeft -= dx
    window.scrollBy(0, -dy)
    d.x = e.clientX
    d.y = e.clientY
  }
  const endDrag = () => { drag.current = null }

  // ── Connectors ──────────────────────────────────────────────────────────
  const paths: { d: string; key: string }[] = []
  for (const round of rounds.slice(1)) {
    for (const m of matchesByRound[round] ?? []) {
      const f = feeders[m.matchId]
      for (const feederId of [f?.player1Feeder, f?.player2Feeder]) {
        if (!feederId || y[feederId] === undefined) continue
        const x1 = col[feederId] * colPitch + cardW
        const x2 = col[m.matchId] * colPitch
        const xm = x1 + colGap / 2
        const y1 = TITLE_H + y[feederId] + CARD_H / 2
        const y2 = TITLE_H + y[m.matchId] + CARD_H / 2
        paths.push({ key: `${feederId}-${m.matchId}`, d: `M${x1} ${y1}H${xm}V${y2}H${x2}` })
      }
    }
  }

  return (
    <div
      ref={scrollRef}
      onScroll={reportVisibleRound}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      className="overflow-x-auto"
      style={{ overscrollBehaviorX: 'contain', cursor: 'grab' }}
    >
      {/* Sized to the scaled layer, so the scroll extent matches what is drawn. */}
      <div style={{ width: layoutW * zoom, height: layoutH * zoom, position: 'relative' }}>
        <div
          ref={layerRef}
          style={{
            position: 'absolute', top: 0, left: 0,
            width: layoutW, height: layoutH,
            transform: `scale(${zoom})`, transformOrigin: '0 0',
          }}
        >
          {rounds.map((round, ri) => (
            <div
              key={round}
              style={{
                position: 'absolute', left: ri * colPitch, top: 0, width: cardW, height: TITLE_H - 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em',
                color: 'var(--muted)', background: 'white', border: '1px solid var(--chalk-dim)', borderRadius: '2px',
                textTransform: 'uppercase',
              }}
            >
              {roundLabels[round] ?? round}
            </div>
          ))}

          <svg
            width={layoutW}
            height={layoutH}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            aria-hidden="true"
          >
            {paths.map(p => (
              <path key={p.key} d={p.d} fill="none" stroke="var(--chalk-dim)" strokeWidth={1.5} />
            ))}
          </svg>

          {rounds.flatMap(round => (matchesByRound[round] ?? []).map(m => {
            const card = cardFor(m.matchId)
            const border = card.isBye ? '#bfdbfe' : 'var(--chalk-dim)'
            return (
              <div
                key={m.matchId}
                data-full-match-id={m.matchId}
                className="bg-white rounded-sm overflow-hidden"
                style={{
                  position: 'absolute', left: col[m.matchId] * colPitch, top: TITLE_H + y[m.matchId],
                  width: cardW, height: CARD_H, border: `1px solid ${border}`,
                  cursor: 'default',
                }}
              >
                <div
                  className="flex items-center justify-between"
                  style={{ height: HEADER_H, padding: '0 6px', background: card.isBye ? '#eff6ff' : '#fafaf8', borderBottom: `1px solid ${border}` }}
                >
                  {card.badge ? (
                    <span
                      title={card.badge.title}
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.05em',
                        color: card.badge.color, background: card.badge.bg, padding: card.badge.bg ? '0 4px' : 0,
                        borderRadius: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {card.badge.text}
                    </span>
                  ) : <span />}
                  {!card.isBye && (
                    <button
                      onClick={() => onOpenMatch(m.matchId, m.round)}
                      title="Open this match in the round list — locking and player stats are there"
                      aria-label="Open this match in the round list"
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.05em',
                        color: 'var(--muted)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                      }}
                    >
                      DETAILS ↗
                    </button>
                  )}
                </div>
                {card.sides.map((side, si) => (
                  <button
                    key={si}
                    onClick={() => side.player && onPlayerClick(m.matchId, side.player.externalId)}
                    disabled={!side.clickable}
                    title={side.title ?? side.player?.name}
                    className="w-full flex items-center text-left"
                    style={{
                      height: ROW_H, padding: '0 6px', gap: 5,
                      borderBottom: si === 0 ? `1px solid ${border}` : undefined,
                      backgroundColor: side.bg,
                      backgroundImage: side.projected
                        ? 'repeating-linear-gradient(135deg, rgba(90,90,74,0.10) 0 1px, transparent 1px 10px)'
                        : undefined,
                      cursor: side.clickable ? 'pointer' : 'default',
                      opacity: side.player ? 1 : 0.4,
                    }}
                  >
                    {side.player?.seed ? (
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.5rem', fontWeight: 600, color: 'white',
                        background: '#5a5a4a', minWidth: 13, height: 13, borderRadius: 2, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{side.player.seed}</span>
                    ) : <span style={{ minWidth: 13, flexShrink: 0 }} />}
                    <span className="truncate" style={{
                      flex: 1, minWidth: 0,
                      fontFamily: 'var(--font-display)', fontSize: nameSize, letterSpacing: '-0.01em',
                      color: side.player ? 'var(--ink)' : 'var(--muted)',
                    }}>
                      {side.player?.name ?? (card.isBye ? 'BYE' : 'TBD')}
                    </span>
                    {side.player?.country && side.player.country.toLowerCase() !== 'world' && (
                      <CountryFlag country={side.player.country} size={11} />
                    )}
                    {side.mark && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 600, color: side.mark.color, flexShrink: 0 }}>
                        {side.mark.text}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )
          }))}
        </div>
      </div>
    </div>
  )
}
