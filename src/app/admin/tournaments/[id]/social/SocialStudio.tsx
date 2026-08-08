'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { recapCapacity, pickedLabel } from '@/lib/social/layout'
import { listRecapMatches, type RecapMatchList } from './actions'

type Kind = 'draw' | 'recap' | 'complete'
type Size = 'story' | 'square'

const KIND_LABEL: Record<Kind, string> = {
  draw: 'Draw published',
  recap: 'Round recap',
  complete: 'Champion',
}

const SIZE_LABEL: Record<Size, string> = {
  story: 'Story 9:16',
  square: 'Post 1:1',
}

interface Props {
  tournamentId: string
  tournamentName: string
  flagEmoji: string
  hasDraw: boolean
  rounds: Array<{ round: string; label: string }>
  hasFinal: boolean
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function SocialStudio({
  tournamentId,
  tournamentName,
  flagEmoji,
  hasDraw,
  rounds,
  hasFinal,
}: Props) {
  const available = useMemo<Kind[]>(() => {
    const k: Kind[] = []
    if (hasDraw) k.push('draw')
    if (rounds.length) k.push('recap')
    if (hasFinal) k.push('complete')
    return k
  }, [hasDraw, rounds.length, hasFinal])

  // Open on the most newsworthy card the tournament currently supports, which is
  // the latest stage it has reached.
  const [kind, setKind] = useState<Kind>(available[available.length - 1] ?? 'draw')
  const [size, setSize] = useState<Size>('story')
  const [round, setRound] = useState<string>(rounds[rounds.length - 1]?.round ?? '')
  const [showNames, setShowNames] = useState(false)

  // ── Match picker ────────────────────────────────────────────────────────────
  // `null` means "no selection" — the card takes the round from the top, which is
  // what it did before this control existed. An array (including an empty one) is
  // a deliberate choice and is sent to the renderer verbatim.
  const [selected, setSelected] = useState<string[] | null>(null)
  const [matchList, setMatchList] = useState<{ forRound: string; data?: RecapMatchList; error?: string } | null>(null)

  const needsMatches = kind === 'recap' && !!round
  const matchesLoading = needsMatches && matchList?.forRound !== round

  useEffect(() => {
    if (kind !== 'recap' || !round) return
    let cancelled = false

    void (async () => {
      try {
        const res = await listRecapMatches(tournamentId, round)
        if (cancelled) return
        setMatchList(res.ok ? { forRound: round, data: res.data } : { forRound: round, error: res.error })
      } catch (e) {
        if (!cancelled) {
          setMatchList({ forRound: round, error: e instanceof Error ? e.message : 'Could not load matches' })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [tournamentId, kind, round])

  // Memoised because the `[]` branch is a fresh array each render, which would
  // otherwise invalidate every downstream useMemo on every keystroke.
  const roundMatches = useMemo(
    () => (matchList?.forRound === round ? (matchList.data?.matches ?? []) : []),
    [matchList, round],
  )
  const capacity = recapCapacity(size, matchList?.data?.hasPodium ?? false)

  // The single source of truth for what the card will show — the checkboxes read
  // from it and the preview URL is built from it, so the ticked boxes and the PNG
  // cannot disagree. Deriving it (rather than trimming `selected` in an effect)
  // also means switching format re-slices to the new capacity for free.
  const chosenIds = useMemo(() => {
    const pool = selected === null ? roundMatches : roundMatches.filter(m => selected.includes(m.id))
    return pool.map(m => m.id).slice(0, capacity)
  }, [roundMatches, selected, capacity])

  const toggleMatch = useCallback(
    (id: string) => {
      // Built from what is on screen, not from `selected`, so a match trimmed by
      // a capacity change does not come back from the dead on the next click.
      setSelected(chosenIds.includes(id) ? chosenIds.filter(x => x !== id) : [...chosenIds, id])
    },
    [chosenIds],
  )

  const src = useMemo(() => {
    const p = new URLSearchParams({ kind, size })
    if (kind === 'recap' && round) p.set('round', round)
    // Omitted while `selected` is null so the first render matches the server's
    // own default instead of re-fetching an identical image once the match list
    // arrives.
    if (kind === 'recap' && selected !== null) p.set('matches', chosenIds.join(','))
    if (showNames) p.set('names', '1')
    return `/admin/tournaments/${tournamentId}/social/image?${p}`
  }, [tournamentId, kind, size, round, showNames, selected, chosenIds])

  // The preview and the download share one fetch of one render. Pointing an
  // <img> straight at the route would be simpler, but then a failed render shows
  // as a broken-image icon with the reason (a 422 body) unreadable, and the
  // download would re-render the card — two chances for the file to differ from
  // what was approved on screen.
  const [result, setResult] = useState<{ forSrc: string; url?: string; error?: string } | null>(null)
  const urlRef = useRef<string | null>(null)
  const loading = result?.forSrc !== src

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch(src)
        if (!res.ok) {
          const text = await res.text()
          if (!cancelled) setResult({ forSrc: src, error: text || `Render failed (${res.status})` })
          return
        }
        const objectUrl = URL.createObjectURL(await res.blob())
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        // Release the previous render only once its replacement is in hand, so
        // the visible <img> never points at a revoked URL.
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = objectUrl
        setResult({ forSrc: src, url: objectUrl })
      } catch (e) {
        if (!cancelled) setResult({ forSrc: src, error: e instanceof Error ? e.message : 'Render failed' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [src])

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  const filename = `qp-${slugify(tournamentName)}-${kind}${kind === 'recap' && round ? `-${round.toLowerCase()}` : ''}-${size}.png`
  const aspect = size === 'story' ? 1080 / 1920 : 1
  const previewWidth = size === 'story' ? 300 : 380

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 px-4 md:px-6 py-4">
          <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Admin
          </Link>
          <span
            className="truncate"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}
          >
            {flagEmoji} {tournamentName}
          </span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 flex flex-col md:flex-row gap-8">
        {/* Controls */}
        <div className="flex flex-col gap-6 md:w-72 md:flex-shrink-0">
          <Field label="Card">
            <div className="flex flex-wrap gap-2">
              {(['draw', 'recap', 'complete'] as Kind[]).map(k => {
                const enabled = available.includes(k)
                return (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    disabled={!enabled}
                    className="px-3 py-1.5 text-xs rounded-sm border disabled:opacity-35 disabled:cursor-not-allowed"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      borderColor: kind === k ? 'var(--court)' : 'var(--chalk-dim)',
                      background: kind === k ? 'var(--court)' : 'white',
                      color: kind === k ? 'white' : 'var(--muted)',
                    }}
                    title={enabled ? undefined : 'Not available for this tournament yet'}
                  >
                    {KIND_LABEL[k]}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Format">
            <div className="flex flex-wrap gap-2">
              {(['story', 'square'] as Size[]).map(s => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className="px-3 py-1.5 text-xs rounded-sm border"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    borderColor: size === s ? 'var(--court)' : 'var(--chalk-dim)',
                    background: size === s ? 'var(--court)' : 'white',
                    color: size === s ? 'white' : 'var(--muted)',
                  }}
                >
                  {SIZE_LABEL[s]}
                </button>
              ))}
            </div>
          </Field>

          {kind === 'recap' && rounds.length > 0 && (
            <Field label="Round">
              <select
                value={round}
                onChange={e => {
                  setRound(e.target.value)
                  // A selection is a set of match ids from the old round; keeping
                  // it across the switch would select nothing in the new one.
                  setSelected(null)
                }}
                className="w-full px-3 py-2 text-xs rounded-sm border bg-white"
                style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--chalk-dim)', color: 'var(--ink)' }}
              >
                {rounds.map(r => (
                  <option key={r.round} value={r.round}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* The count joins the label only once there is a list behind it —
              "0/6" while loading reads as an empty selection rather than an
              unanswered question, and the 6 is wrong too, since capacity depends
              on a podium the fetch has not reported yet. */}
          {needsMatches && (
            <Field label={matchesLoading || matchList?.error ? 'Matches' : `Matches — ${chosenIds.length}/${capacity}`}>
              {matchesLoading ? (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                  Loading matches…
                </p>
              ) : matchList?.error ? (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--clay)' }}>
                  {matchList.error}
                </p>
              ) : (
                <>
                  <div
                    className="flex flex-col gap-1 overflow-y-auto rounded-sm border bg-white p-1"
                    style={{ borderColor: 'var(--chalk-dim)', maxHeight: '17rem' }}
                  >
                    {roundMatches.map(m => {
                      const checked = chosenIds.includes(m.id)
                      // At capacity the unticked rows lock rather than silently
                      // dropping off the card: the count in the label and the
                      // preview stay the same thing.
                      const full = !checked && chosenIds.length >= capacity
                      const count = pickedLabel(m.pickedCount, m.pickedPct)
                      return (
                        <label
                          key={m.id}
                          className="flex items-start gap-2 px-2 py-1.5 rounded-sm"
                          style={{
                            cursor: full ? 'not-allowed' : 'pointer',
                            opacity: full ? 0.4 : 1,
                            background: checked ? 'var(--chalk)' : 'transparent',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={full}
                            onChange={() => toggleMatch(m.id)}
                            className="mt-0.5 flex-shrink-0"
                          />
                          <span className="min-w-0 flex flex-col">
                            <span
                              className="truncate"
                              style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--ink)' }}
                            >
                              {m.winner} <span style={{ color: 'var(--muted)' }}>d.</span> {m.loser}
                            </span>
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.6rem',
                                color: m.isUpset ? 'var(--clay)' : 'var(--muted)',
                              }}
                            >
                              {[m.score, m.isUpset ? 'UPSET' : null, count].filter(Boolean).join('  ·  ')}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                    {roundMatches.length === 0 && (
                      <p
                        className="px-2 py-1.5"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}
                      >
                        No matches in this round.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setSelected(null)}
                      className="text-left"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--court)' }}
                    >
                      Reset to first {capacity}
                    </button>
                    <button
                      onClick={() => setSelected([])}
                      className="text-left"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}
                    >
                      Clear
                    </button>
                  </div>
                </>
              )}
            </Field>
          )}

          {kind !== 'draw' && (
            <Field label="Usernames">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showNames}
                  onChange={e => setShowNames(e.target.checked)}
                  className="mt-0.5"
                />
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                  Show the leading players&rsquo; usernames. Off by default — turning it on puts their handle on a
                  public post.
                </span>
              </label>
            </Field>
          )}

          <a
            href={result?.url && !loading ? result.url : undefined}
            download={filename}
            aria-disabled={!result?.url || loading}
            className="block text-center px-4 py-2.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-90"
            style={{
              background: result?.url && !loading ? 'var(--court)' : 'var(--chalk-dim)',
              color: result?.url && !loading ? 'white' : 'var(--muted)',
              pointerEvents: result?.url && !loading ? 'auto' : 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Download PNG
          </a>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '-12px' }}>
            {size === 'story' ? '1080 × 1920' : '1080 × 1080'} · {filename}
          </p>
        </div>

        {/* Preview */}
        <div className="flex-1 flex flex-col items-center gap-3">
          <div
            className="w-full"
            style={{
              maxWidth: previewWidth,
              aspectRatio: String(aspect),
              background: 'white',
              border: '1px solid var(--chalk-dim)',
              borderRadius: '4px',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            {result?.error ? (
              <p
                className="px-4 text-center"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--clay)' }}
              >
                {result.error}
              </p>
            ) : result?.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- a blob: URL cannot go through next/image
              <img
                src={result.url}
                alt={`${KIND_LABEL[kind]} card`}
                style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: loading ? 0.4 : 1 }}
              />
            ) : null}

            {loading && (
              <span
                style={{
                  position: 'absolute',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.7rem',
                  color: 'var(--muted)',
                }}
              >
                Rendering…
              </span>
            )}
          </div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
            Exactly what downloads — preview and file are the same render.
          </p>
        </div>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.65rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  )
}
