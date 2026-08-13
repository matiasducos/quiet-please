'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Username search for the leaderboard.
 *
 * The query lives in the URL (`?q=`) rather than in component state, for the
 * same reason scope and circuit do: the board is a server component, and the
 * rank of a searched player has to be counted in Postgres against the scope
 * currently being viewed. A client-side filter could only ever search the 50
 * rows already on screen, which is precisely the problem this solves.
 *
 * The current params arrive as a string prop instead of via `useSearchParams`
 * so this component never forces a Suspense boundary into the leaderboard tree
 * — one above the page breaks `notFound()` status codes elsewhere in the app.
 */
export default function LeaderboardSearch({
  initialQuery,
  baseQuery,
  scopeLabel,
  basePath = '/leaderboard',
}: {
  initialQuery: string
  /** Query string carrying scope/circuit/etc., without `q` or `page`. */
  baseQuery: string
  /** Where the search looks, e.g. "worldwide" — shown in the placeholder. */
  scopeLabel: string
  /** Route the search writes into — the per-tournament board passes its own. */
  basePath?: string
}) {
  const router = useRouter()
  const [value, setValue] = useState(initialQuery)
  const [syncedQuery, setSyncedQuery] = useState(initialQuery)
  const [isPending, startTransition] = useTransition()
  /** A keystroke is typed but not yet sent. State, not the timer ref — the
   *  sync below runs during render, where reading a ref is not allowed. */
  const [dirty, setDirty] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  /*
   * Follow the URL when it changes underneath us.
   *
   * Navigating within the same route — the nav's own Leaderboard link, or
   * "Jump to page 3" from a set of results — re-renders the server component
   * but does not remount this one, so without this the box would keep showing
   * a term the board is no longer filtered by.
   *
   * Adjusting state during render rather than in an effect: this is the case
   * React documents it for, and an effect here would trip the same
   * set-state-in-effect rule that a prop-sync always does. The two guards make
   * it safe to skip while a keystroke is still in flight — a slow round trip
   * answering with an older term must never overwrite what is being typed.
   */
  if (initialQuery !== syncedQuery && !dirty && !isPending) {
    setSyncedQuery(initialQuery)
    setValue(initialQuery)
  }

  function commit(next: string) {
    const params = new URLSearchParams(baseQuery)
    const trimmed = next.trim()
    // Under 2 characters a search matches most of the board, so it stays off.
    if (trimmed.length >= 2) params.set('q', trimmed)
    else params.delete('q')
    // A new search always starts from its own results, never page 4 of the old view.
    params.delete('page')
    const qs = params.toString()
    startTransition(() => router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false }))
  }

  function schedule(next: string) {
    if (timer.current) clearTimeout(timer.current)
    setDirty(true)
    // Clears as it fires, so the sync above knows nothing is queued locally.
    timer.current = setTimeout(() => { timer.current = null; setDirty(false); commit(next) }, 350)
  }

  const showClear = value.length > 0

  return (
    <form
      role="search"
      className="mb-4"
      // No `action`: a GET form posts to the current path, so pressing Enter
      // produces `<basePath>?…&q=term` on its own. That is the whole search
      // working before this component has hydrated — the debounce below is the
      // upgrade, not the mechanism.
      onSubmit={e => {
        e.preventDefault()
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
        setDirty(false)
        commit(value)
      }}
    >
      {/*
        A GET submit replaces the entire query string with just the form's
        fields, which would silently drop the visitor from the WTA board in
        their own city back onto the worldwide one. Carrying the board params
        as hidden fields keeps the no-JS path on the same board as the JS path.
      */}
      {[...new URLSearchParams(baseQuery)].map(([key, val]) => (
        <input key={key} type="hidden" name={key} value={val} />
      ))}
      <div
        className="flex items-center gap-2 rounded-sm border px-3 py-2"
        style={{ background: 'white', borderColor: 'var(--chalk-dim)' }}
      >
        <span aria-hidden="true" style={{ fontSize: '0.85rem', color: 'var(--muted)', flexShrink: 0 }}>
          🔍
        </span>
        <input
          type="search"
          name="q"
          value={value}
          onChange={e => { setValue(e.target.value); schedule(e.target.value) }}
          placeholder={`Find a player ${scopeLabel}…`}
          aria-label="Search players by username"
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent outline-none"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            color: 'var(--ink)',
            // Safari draws its own clear button on type=search; we render one.
            WebkitAppearance: 'none',
          }}
        />
        {isPending && (
          <span
            aria-live="polite"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', flexShrink: 0 }}
          >
            …
          </span>
        )}
        {showClear && (
          <button
            type="button"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current)
              timer.current = null
              setDirty(false)
              setValue('')
              commit('')
            }}
            aria-label="Clear search"
            className="flex-shrink-0 px-1"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1 }}
          >
            ✕
          </button>
        )}
      </div>
    </form>
  )
}
