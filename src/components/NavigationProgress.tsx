'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * A thin bar across the top of the viewport while a route change is in flight.
 *
 * Between clicking a link and the new page painting, an App Router navigation
 * shows nothing at all — the old page stays fully rendered and interactive
 * while the RSC payload is fetched. On this app that gap is 300–500ms on a good
 * connection before any server work, which is far past the point where a click
 * stops feeling acknowledged. Users read it as a dead button and click again.
 *
 * The usual fix is a `loading.tsx` per segment, and it is not available here:
 * 31 of the 45 non-admin routes without one call `notFound()` or `redirect()`,
 * and `loading.tsx` compiles to a Suspense boundary that turns those into
 * 200-status soft 404s and meta-refresh redirects. See the note in layout.tsx.
 * A bar driven from the client sidesteps that entirely — it is not a boundary,
 * so it cannot intercept a throw on its way to the document root.
 *
 * Renders nothing but the bar itself, and takes no children, for the same
 * reason PostHogPageviews does: it calls useSearchParams(), so it needs a
 * Suspense boundary, and that boundary must never contain the page tree.
 */

/*
 * Below this, a navigation is over before a bar could mean anything, and
 * flashing one is worse than staying quiet — it reads as a glitch. Prefetched
 * and cached routes land well inside this; the slow ones this exists for are
 * several times it.
 */
const SHOW_DELAY_MS = 100

/*
 * Hard stop. If a navigation is cancelled, or ends somewhere the pathname and
 * query both look unchanged, nothing else would ever clear the bar and it would
 * sit there implying work that is not happening.
 */
const MAX_VISIBLE_MS = 15_000

/* Matches the fade in globals.css; the bar unmounts once it has played. */
const FADE_MS = 260

/*
 * Click → start is a DOM listener rather than a prop on every Link because
 * there are 280 of them across 95 files, and any one that got missed would be
 * exactly the button someone reports as broken. Listening once, in the capture
 * phase, also picks up links rendered by anything that does not go through our
 * own components.
 *
 * `router.push` cannot be seen this way, so the sites that navigate
 * imperatively call startNavigationProgress() themselves.
 */
type Listener = (active: boolean) => void
let listener: Listener | null = null
let pendingStart = false

/**
 * Show the bar for a navigation this component cannot observe — a
 * `router.push` from a select, a button, or a callback after a server action.
 *
 * Safe to call when no navigation follows: the bar clears itself after
 * MAX_VISIBLE_MS regardless.
 */
export function startNavigationProgress() {
  if (listener) listener(true)
  else pendingStart = true // fired before mount; replayed on subscribe
}

/**
 * Whether a click on this anchor will actually cause an in-app route change.
 *
 * Every false here is a case where starting the bar would leave it running with
 * nothing to finish it — the navigation either never happens or takes the
 * document with it.
 */
function isInAppNavigation(e: MouseEvent, a: HTMLAnchorElement): boolean {
  // Modified clicks open a new tab or window; this document does not navigate.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  // Only the primary button navigates. Middle-click opens a tab.
  if (e.button !== 0) return false
  if (e.defaultPrevented) return false

  if (a.target && a.target !== '_self') return false
  if (a.hasAttribute('download')) return false

  const href = a.getAttribute('href')
  if (!href) return false
  // `mailto:`, `tel:`, and in-page anchors are not route changes.
  if (href.startsWith('#')) return false

  let url: URL
  try {
    url = new URL(a.href, location.href)
  } catch {
    return false
  }
  if (url.origin !== location.origin) return false
  // Same page, different fragment — the router does not re-render.
  if (url.pathname === location.pathname && url.search === location.search) return false

  return true
}

export default function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  /*
   * 'idle'    — nothing rendered.
   * 'running' — the bar is on screen, creeping toward 90% under a CSS keyframe
   *             animation that starts the moment it mounts. It is deliberately
   *             a long decelerating curve that never arrives: a bar that
   *             reaches the end claims the page is ready when it is not.
   * 'done'    — the route committed; the bar fades out where it stands.
   *
   * The creep is a keyframe rather than a transition from a zero-width first
   * render, because a transition needs its start value committed to the DOM
   * before the target is set. Doing that from React means either a
   * double-requestAnimationFrame (which can lose the race in a throttled tab —
   * the bar is then removed having never been wider than nothing) or a forced
   * reflow inside an effect. A keyframe just starts at `from`.
   *
   * It also means completion does not sweep to 100%: there is no way to
   * transition out of an animated width without the value jumping. Fading in
   * place is the honest signal anyway — the page arriving is what tells the
   * user the wait is over, and the bar's only remaining job is to leave.
   */
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const active = useRef(false)

  useEffect(() => {
    const clearTimers = () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }

    const start = () => {
      if (active.current) return
      active.current = true
      clearTimers()
      timers.current.push(setTimeout(() => setPhase('running'), SHOW_DELAY_MS))
      timers.current.push(setTimeout(finish, MAX_VISIBLE_MS))
    }

    const finish = () => {
      if (!active.current) return
      active.current = false
      clearTimers()
      // Still inside SHOW_DELAY_MS: the navigation beat the bar to the screen,
      // so there is nothing to fade and nothing the user needs told.
      setPhase(current => (current === 'running' ? 'done' : 'idle'))
      timers.current.push(setTimeout(() => setPhase('idle'), FADE_MS))
    }

    listener = (on: boolean) => (on ? start() : finish())
    if (pendingStart) {
      pendingStart = false
      start()
    }

    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a')
      if (!a) return
      if (!isInAppNavigation(e, a as HTMLAnchorElement)) return
      start()
    }

    /*
     * Capture phase: a handler on the link itself may call preventDefault or
     * stop propagation, and we would rather start a bar that clears itself than
     * miss the click that mattered.
     */
    document.addEventListener('click', onClick, true)
    // Back/forward is a navigation too, and on a cold cache it is just as slow.
    window.addEventListener('popstate', start)

    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', start)
      listener = null
      clearTimers()
    }
  }, [])

  /*
   * The route committed. This is the only honest completion signal available:
   * usePathname/useSearchParams update once the new page is rendering, which is
   * exactly the moment the user has something to look at.
   *
   * The dependency is the SERIALISED query, never the ReadonlyURLSearchParams
   * object. That object is a fresh identity on renders where the query has not
   * changed, so depending on it makes this effect fire on every render — and
   * one of those renders is the one that puts the bar on screen. The effect
   * would then finish the navigation a frame after it started and the bar would
   * never appear. It fails exactly that way: silently, and only for real
   * navigations, which is why it survived the first round of testing here.
   *
   * Skipped on mount — the first render is a page load, not a navigation.
   */
  const search = searchParams.toString()
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    listener?.(false)
  }, [pathname, search])

  if (phase === 'idle') return null

  return (
    <>
      <div aria-hidden="true" className="nav-progress-bar" data-phase={phase} />
      {/*
        Sighted users get the bar; without this, screen reader users are left
        with exactly the silence the bar exists to fix. Polite, so it never
        interrupts what is being read.
      */}
      <span role="status" aria-live="polite" className="nav-progress-status">
        {phase === 'running' ? 'Loading page' : ''}
      </span>
    </>
  )
}
