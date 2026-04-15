'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Hover-triggered tooltip that renders via React Portal into document.body.
 * This escapes any ancestor with `overflow: hidden/auto` (e.g. tables with
 * horizontal scroll) that would otherwise clip an absolute-positioned bubble.
 *
 * Positioning uses `position: fixed` with viewport-relative coordinates
 * computed from the trigger's bounding rect on hover.
 *
 * Mobile note: `:hover` is unreliable on touch devices. This component still
 * shows the tooltip on tap (via a tap → first-hover → dismiss-on-outside-tap
 * chain handled by onTouchStart/onTouchEnd). If broader touch UX is needed,
 * promote this to a click-triggered popover.
 */
export default function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Compute position relative to viewport on open; keep stable during hover.
  const computePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setCoords({
      top: rect.top, // bubble is translated above with translate(-50%, calc(-100% - 8px))
      left: rect.left + rect.width / 2,
    })
  }

  const show = () => {
    computePosition()
    setOpen(true)
  }
  const hide = () => setOpen(false)

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

      {mounted && open && coords && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            transform: 'translate(-50%, calc(-100% - 8px))',
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
          {/* arrow */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              borderTop: '5px solid #1a1a2e',
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
