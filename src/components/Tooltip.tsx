'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Hover-triggered tooltip that renders via React Portal into document.body.
 * This escapes any ancestor with `overflow: hidden/auto` (e.g. tables with
 * horizontal scroll) that would otherwise clip an absolute-positioned bubble.
 *
 * Positioning uses `position: fixed` with viewport-relative coordinates
 * computed from the trigger's bounding rect on hover.
 *
 * IT HAS TO FLIP, AND IT HAS TO CLAMP
 *
 * The bubble used to be pinned above the trigger with a fixed transform. The
 * predict page puts an info tooltip on "Lock all picks", which lives in the
 * sticky nav at the very top of the window — so the bubble rendered off the top
 * of the viewport and the user saw a sliver of a dark box, or nothing. The
 * explanation of the single most consequential button on the page was the one
 * that could not be read.
 *
 * The same applies sideways: that button sits near the right edge, and a 260px
 * bubble centred on it hangs off the screen.
 *
 * So placement is measured rather than assumed — render hidden, measure, then
 * decide above or below and clamp into the viewport. The arrow keeps pointing
 * at the trigger even when the bubble has been clamped away from its centre,
 * because an arrow aimed at empty space is worse than no arrow.
 */

/** Gap between trigger and bubble, and the minimum breathing room at any edge. */
const MARGIN = 8

// useLayoutEffect warns when React renders on the server; the DOM-measuring
// version is only ever needed in the browser.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

type Placement = 'top' | 'bottom'

export default function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  /** Where the trigger is. Captured on open; the bubble is placed against it. */
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; centre: number } | null>(null)
  /** Resolved position. Null until measured — the bubble stays hidden till then. */
  const [pos, setPos] = useState<{ top: number; left: number; placement: Placement; arrow: number } | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setAnchor({ top: rect.top, bottom: rect.bottom, centre: rect.left + rect.width / 2 })
    setPos(null)
    setOpen(true)
  }
  const hide = () => setOpen(false)

  // Measure the rendered bubble, then place it. This runs before paint, so the
  // bubble is never visible in the wrong spot.
  useIsomorphicLayoutEffect(() => {
    if (!open || !anchor) return
    const bubble = bubbleRef.current
    if (!bubble) return

    const { width, height } = bubble.getBoundingClientRect()

    // Above by preference — it is out of the way of whatever the trigger sits
    // in — but only when the bubble actually fits there.
    const fitsAbove = anchor.top - height - MARGIN >= MARGIN
    const placement: Placement = fitsAbove ? 'top' : 'bottom'
    const top = fitsAbove ? anchor.top - height - MARGIN : anchor.bottom + MARGIN

    // `left` is the bubble's centre (it is translated -50%), so clamp the centre
    // such that neither edge crosses the margin.
    const half = width / 2
    const min = MARGIN + half
    const max = window.innerWidth - MARGIN - half
    // A bubble wider than the viewport has no valid centre; keep it centred
    // rather than letting the clamp invert.
    const left = min > max ? window.innerWidth / 2 : Math.min(Math.max(anchor.centre, min), max)

    // How far the arrow sits from the bubble's centre, so it still points at the
    // trigger after clamping. Kept inside the rounded corners.
    const arrow = Math.max(-half + 10, Math.min(anchor.centre - left, half - 10))

    setPos({ top, left, placement, arrow })
  }, [open, anchor])

  // Dismiss on scroll/resize since fixed position becomes stale
  useEffect(() => {
    if (!open) return
    const dismiss = () => setOpen(false)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open])

  const pointsUp = pos?.placement === 'bottom'

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onTouchStart={(e) => {
          // Tap to toggle on touch devices
          e.stopPropagation()
          open ? hide() : show()
        }}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      >
        {children}
      </span>

      {mounted && open && anchor && createPortal(
        <div
          ref={bubbleRef}
          role="tooltip"
          style={{
            position: 'fixed',
            // The measuring pass renders hidden but CENTRED, not at 0. Anchored
            // at the left edge, half the bubble sits outside the viewport and it
            // lays out at a different width than it will finally take — which
            // fed a stale width into the clamp and pushed the bubble 40px
            // further from the edge than it needed to be.
            top: pos ? pos.top : 0,
            left: pos ? pos.left : '50%',
            transform: 'translateX(-50%)',
            visibility: pos ? 'visible' : 'hidden',
            minWidth: 180,
            maxWidth: 260,
            padding: '8px 10px',
            background: '#1a1a2e',
            color: '#f0f0f0',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.65rem',
            lineHeight: 1.5,
            letterSpacing: '0.01em',
            borderRadius: 4,
            whiteSpace: 'normal',
            pointerEvents: 'none',
            zIndex: 1000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
          }}
        >
          {text}
          {/* arrow — flips with the bubble, and tracks the trigger when clamped */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              ...(pointsUp ? { bottom: '100%' } : { top: '100%' }),
              left: `calc(50% + ${pos?.arrow ?? 0}px)`,
              transform: 'translateX(-50%)',
              ...(pointsUp
                ? { borderBottom: '5px solid #1a1a2e' }
                : { borderTop: '5px solid #1a1a2e' }),
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
            }}
          />
        </div>,
        document.body
      )}
    </>
  )
}
