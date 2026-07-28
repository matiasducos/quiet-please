'use client'

import { useState, useRef, useEffect, useLayoutEffect, useId, useSyncExternalStore } from 'react'

const HOVER_QUERY = '(hover: hover)'

/** Subscribes to the hover media query without syncing it into state in an effect. */
function useCanHover(): boolean {
  return useSyncExternalStore(
    onChange => {
      const mq = window.matchMedia(HOVER_QUERY)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => window.matchMedia(HOVER_QUERY).matches,
    () => false, // server render: assume touch, so the popover stays click-driven
  )
}

/**
 * Small "i" affordance that explains the section it sits next to.
 *
 * Opens on hover for pointer devices and on tap everywhere. Hover is gated on
 * `(hover: hover)` rather than applied unconditionally: on touch screens a tap
 * fires mouseenter first, so an unconditional hover handler would open the
 * popover and the click would immediately toggle it shut again.
 */
export default function InfoBubble({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const canHover = useCanHover()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)
  const id = useId()

  // The popover is anchored to the bubble, which can sit anywhere across the
  // width of a heading — left-aligning it unconditionally pushes it past the
  // right edge on narrow screens and makes the whole page scroll sideways.
  // Nudge it back by however much it overflows. Written to the node rather than
  // to state so this stays a measurement, not a render cycle.
  useLayoutEffect(() => {
    const el = popRef.current
    if (!open || !el) return
    el.style.left = '0px'
    const margin = 8
    const overflowRight = el.getBoundingClientRect().right - (document.documentElement.clientWidth - margin)
    if (overflowRight > 0) el.style.left = `${-overflowRight}px`
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // On hover devices the pointer drives it. Click must NOT also toggle there:
  // mouseenter opens it and the click that follows would immediately close it
  // again, making a click look like it does nothing.
  const hoverProps = canHover
    ? { onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) }
    : {}

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }} {...hoverProps}>
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => { if (!canHover) setOpen(v => !v) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          width: '15px', height: '15px', borderRadius: '50%',
          border: '1px solid var(--chalk-dim)', background: 'transparent',
          color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
          lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 0, flexShrink: 0,
        }}
      >
        i
      </button>

      {open && (
        <span
          ref={popRef}
          id={id}
          role="tooltip"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 30,
            width: '250px', maxWidth: '76vw',
            background: 'white', border: '1px solid var(--chalk-dim)', borderRadius: '3px',
            padding: '9px 11px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            fontFamily: 'var(--font-mono)', fontSize: '0.65rem', lineHeight: 1.6,
            color: 'var(--muted)', textAlign: 'left', fontWeight: 400,
            textTransform: 'none', letterSpacing: 'normal',
          }}
        >
          {children}
        </span>
      )}
    </span>
  )
}
