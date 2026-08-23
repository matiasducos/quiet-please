'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The three things a collapsed reference page needs that HTML alone won't do.
 *
 * The answers are `<details>` elements rendered on the server, so the page works
 * with no JavaScript at all: every question opens on click, and every answer is
 * in the HTML whether it is open or not — which is what keeps the content
 * indexable and keeps the structured data honest about the visible page.
 *
 * What plain HTML cannot do is the three below. Each one exists because
 * collapsing takes something away that the long page had for free.
 */

export default function FaqControls() {
  const [showTop, setShowTop] = useState(false)
  const [allOpen, setAllOpen] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)

  /**
   * 1. Deep links must still land.
   *
   * /faq#streak-multiplier is linked from the bracket, and a `<details>` does
   * not open just because something inside it is the URL fragment. Without
   * this, following that link scrolls to a collapsed one-line summary and the
   * answer the link promised is nowhere on screen.
   *
   * Runs on mount and on every hash change, because in-page contents links do
   * not remount anything.
   */
  useEffect(() => {
    function openTarget() {
      const id = decodeURIComponent(window.location.hash.slice(1))
      if (!id) return
      const el = document.getElementById(id)
      if (!(el instanceof HTMLDetailsElement)) return
      el.open = true
      // After opening, re-run the jump: the browser already scrolled to where
      // the collapsed element used to be, which is now the wrong place.
      el.scrollIntoView()
    }

    openTarget()
    window.addEventListener('hashchange', openTarget)
    return () => window.removeEventListener('hashchange', openTarget)
  }, [])

  /**
   * 2. Find-in-page must stay usable.
   *
   * Browsers do not reliably search inside a closed `<details>` — Chrome will,
   * Safari and Firefox will not. On a reference page that is a real loss, so
   * "Expand all" puts the whole thing back one click away rather than pretending
   * the problem does not exist.
   */
  function toggleAll(open: boolean) {
    for (const el of document.querySelectorAll('details[data-faq]')) {
      (el as HTMLDetailsElement).open = open
    }
    setAllOpen(open)
  }

  /**
   * 3. A long page needs a way back without a scroll marathon.
   *
   * Driven by an IntersectionObserver on the controls row rather than a scroll
   * listener with a pixel threshold. Two reasons: the threshold is then a real
   * thing on the page ("you can no longer see the top of the list") instead of
   * a number that means different things on a phone and a monitor, and the
   * observer does no work per scroll frame.
   */
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setShowTop(!entry.isIntersecting),
      { threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <>
      <div ref={sentinel} className="flex justify-end mb-4">
        <button
          type="button"
          onClick={() => toggleAll(!allOpen)}
          className="inline-flex items-center min-h-[36px] px-3 rounded-sm border"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            borderColor: 'var(--chalk-dim)',
            background: 'white',
          }}
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {showTop && (
        <button
          type="button"
          onClick={() => {
            window.scrollTo({ top: 0 })
            // Clear the fragment so the next click on the same contents link
            // still fires a hashchange and still opens its answer.
            history.replaceState(null, '', window.location.pathname)
          }}
          aria-label="Back to top"
          className="fixed z-40 inline-flex items-center justify-center rounded-sm border shadow-sm"
          // Bottom-right, clear of the cookie bar's buttons on a phone.
          style={{
            right: '1rem',
            bottom: '1.25rem',
            minHeight: '44px',
            minWidth: '44px',
            padding: '0 0.75rem',
            background: 'white',
            borderColor: 'var(--chalk-dim)',
            color: 'var(--ink)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            letterSpacing: '0.05em',
          }}
        >
          ↑ Top
        </button>
      )}
    </>
  )
}
