'use client'

import { useRef, useEffect } from 'react'

interface UseSwipeNavigationOptions {
  onSwipeLeft: () => void   // advance to next round
  onSwipeRight: () => void  // go back to previous round
  enabled?: boolean
  threshold?: number        // minimum horizontal distance (default 50px)
}

/**
 * Detects horizontal swipe gestures on a container element.
 * Returns a ref to attach to the target div.
 *
 * - passive listeners: never blocks vertical scrolling
 * - horizontal > vertical check: avoids accidental triggers while scrolling
 */
export function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
  threshold = 50,
}: UseSwipeNavigationOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!enabled) return
    const el = containerRef.current
    if (!el) return

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      touchStart.current = { x: touch.clientX, y: touch.clientY }
    }

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStart.current) return
      const touch = e.changedTouches[0]
      const dx = touch.clientX - touchStart.current.x
      const dy = touch.clientY - touchStart.current.y
      touchStart.current = null

      // Only trigger on clearly horizontal gestures that exceed the threshold
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
        if (dx < 0) onSwipeLeft()    // finger moved left = advance
        else onSwipeRight()           // finger moved right = go back
      }
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [enabled, threshold, onSwipeLeft, onSwipeRight])

  return containerRef
}
