'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { drawCapacity, recapCapacity, upcomingCapacity, pickedLabel } from '@/lib/social/layout'
import { PUBLISHED_ORIGIN } from '@/lib/site'
import {
  listDrawMatches,
  listRecapMatches,
  listUpcomingMatches,
  type DrawMatchList,
  type RecapMatchList,
  type UpcomingMatchList,
} from './actions'

type Kind = 'draw' | 'upcoming' | 'recap' | 'complete' | 'stats'
type Size = 'story' | 'square'

const KIND_LABEL: Record<Kind, string> = {
  draw: 'Draw published',
  upcoming: 'Up next',
  recap: 'Round recap',
  complete: 'Champion',
  stats: 'Tournament recap',
}

/** Every kind, in the order a tournament reaches them. */
const ALL_KINDS: Kind[] = ['draw', 'upcoming', 'recap', 'complete', 'stats']

const SIZE_LABEL: Record<Size, string> = {
  story: 'Story 9:16',
  square: 'Post 1:1',
}

interface Props {
  tournamentId: string
  tournamentName: string
  flagEmoji: string
  hasDraw: boolean
  /** At least one tie has two known players and no result — see `pendingMatches`. */
  hasUpcoming: boolean
  rounds: Array<{ round: string; label: string }>
  hasFinal: boolean
  /** A stored recap exists, so the tournament-recap card will render. */
  hasRecap: boolean
  /** Series slug for /play/<slug>, or the tournament UUID when it has none. */
  playSlug: string
  /** utm_campaign value — `<slug>-<year>`, so seasons stay comparable. */
  playCampaign: string
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function SocialStudio({
  tournamentId,
  tournamentName,
  flagEmoji,
  hasDraw,
  hasUpcoming,
  rounds,
  hasFinal,
  hasRecap,
  playSlug,
  playCampaign,
}: Props) {
  const available = useMemo<Kind[]>(() => {
    const k: Kind[] = []
    if (hasDraw) k.push('draw')
    if (hasUpcoming) k.push('upcoming')
    if (rounds.length) k.push('recap')
    if (hasFinal) k.push('complete')
    if (hasRecap) k.push('stats')
    return k
  }, [hasDraw, hasUpcoming, rounds.length, hasFinal, hasRecap])

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

  // ── Up next ─────────────────────────────────────────────────────────────────
  // Empty means "whichever round the server considers next". Which rounds exist
  // is derived from the draw rather than from the results table (see
  // `pendingMatches`), so unlike the recap's list it arrives with the matches
  // instead of as a prop — and the effective round is DERIVED from the response
  // rather than synced into state, so the select has a value on first paint
  // without a render pass that writes what it just read.
  const [upRound, setUpRound] = useState('')
  const [upSelected, setUpSelected] = useState<string[] | null>(null)
  const [upList, setUpList] = useState<{ forRound: string; data?: UpcomingMatchList; error?: string } | null>(null)

  const upLoading = kind === 'upcoming' && upList?.forRound !== upRound
  const upRoundEffective = upRound || upList?.data?.round || ''

  useEffect(() => {
    if (kind !== 'upcoming') return
    let cancelled = false

    void (async () => {
      try {
        const res = await listUpcomingMatches(tournamentId, upRound || undefined)
        if (cancelled) return
        setUpList(res.ok ? { forRound: upRound, data: res.data } : { forRound: upRound, error: res.error })
      } catch (e) {
        if (!cancelled) {
          setUpList({ forRound: upRound, error: e instanceof Error ? e.message : 'Could not load matches' })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [tournamentId, kind, upRound])

  const upMatches = useMemo(
    () => (upList?.forRound === upRound ? (upList.data?.matches ?? []) : []),
    [upList, upRound],
  )
  const upCapacity = upcomingCapacity(size)

  const upChosenIds = useMemo(() => {
    const pool = upSelected === null ? upMatches : upMatches.filter(m => upSelected.includes(m.id))
    return pool.map(m => m.id).slice(0, upCapacity)
  }, [upMatches, upSelected, upCapacity])

  const toggleUpMatch = useCallback(
    (id: string) => {
      setUpSelected(upChosenIds.includes(id) ? upChosenIds.filter(x => x !== id) : [...upChosenIds, id])
    },
    [upChosenIds],
  )

  // ── Draw published ──────────────────────────────────────────────────────────
  // The only picker with no round to key on: the draw card is always the first
  // round, so the list is fetched once per visit to the card rather than per
  // control change.
  const [drawSelected, setDrawSelected] = useState<string[] | null>(null)
  const [drawList, setDrawList] = useState<{ data?: DrawMatchList; error?: string } | null>(null)

  const drawLoading = kind === 'draw' && !drawList

  useEffect(() => {
    if (kind !== 'draw') return
    let cancelled = false

    void (async () => {
      try {
        const res = await listDrawMatches(tournamentId)
        if (cancelled) return
        setDrawList(res.ok ? { data: res.data } : { error: res.error })
      } catch (e) {
        if (!cancelled) setDrawList({ error: e instanceof Error ? e.message : 'Could not load matches' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [tournamentId, kind])

  const drawMatches = useMemo(() => drawList?.data?.matches ?? [], [drawList])
  const drawCap = drawCapacity(size)

  const drawChosenIds = useMemo(() => {
    const pool = drawSelected === null ? drawMatches : drawMatches.filter(m => drawSelected.includes(m.id))
    return pool.map(m => m.id).slice(0, drawCap)
  }, [drawMatches, drawSelected, drawCap])

  const toggleDrawMatch = useCallback(
    (id: string) => {
      setDrawSelected(drawChosenIds.includes(id) ? drawChosenIds.filter(x => x !== id) : [...drawChosenIds, id])
    },
    [drawChosenIds],
  )

  const src = useMemo(() => {
    const p = new URLSearchParams({ kind, size })
    if (kind === 'recap' && round) p.set('round', round)
    // Omitted while `selected` is null so the first render matches the server's
    // own default instead of re-fetching an identical image once the match list
    // arrives.
    if (kind === 'recap' && selected !== null) p.set('matches', chosenIds.join(','))
    // Same two omissions for "up next", and the round one matters more here: the
    // studio does not know which round is next until the list comes back, so
    // sending `upRoundEffective` would render the default, then re-render the
    // identical card the moment the fetch resolves.
    if (kind === 'upcoming' && upRound) p.set('round', upRound)
    if (kind === 'upcoming' && upSelected !== null) p.set('matches', upChosenIds.join(','))
    // Same omission again: the draw card's default is "the top of the sheet",
    // which is exactly what the server renders with no `matches` param at all.
    if (kind === 'draw' && drawSelected !== null) p.set('matches', drawChosenIds.join(','))
    if (showNames) p.set('names', '1')
    return `/admin/tournaments/${tournamentId}/social/image?${p}`
  }, [
    tournamentId,
    kind,
    size,
    round,
    showNames,
    selected,
    chosenIds,
    upRound,
    upSelected,
    upChosenIds,
    drawSelected,
    drawChosenIds,
  ])

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

  const roundSuffix =
    kind === 'recap' ? round : kind === 'upcoming' ? upRoundEffective : ''
  const filename = `qp-${slugify(tournamentName)}-${kind}${roundSuffix ? `-${roundSuffix.toLowerCase()}` : ''}-${size}.png`
  const aspect = size === 'story' ? 1080 / 1920 : 1
  const previewWidth = size === 'story' ? 300 : 380

  /**
   * The link that goes in the post, built here rather than assembled by hand.
   *
   * It points at /play — the signed-out bracket landing — not the homepage,
   * because a post about a specific tournament should open that tournament's
   * bracket, and not at /tournaments/<slug>/predict, which bounces anyone
   * without an account straight to a signup wall.
   *
   * `utm_content` carries the card this link was copied next to, so the report
   * separates "the draw-published story converted" from "the round recap did".
   * Hand-typed UTMs never stay that consistent — and an inconsistent one splits
   * a campaign in two, since `deriveAttribution` lowercases and groups on these
   * exact strings.
   *
   * Built on PUBLISHED_ORIGIN, not SITE_URL: this string gets pasted into a
   * story sticker, and SITE_URL is localhost in local development.
   */
  const playUrl = useMemo(() => {
    const url = new URL(`/play/${playSlug}`, PUBLISHED_ORIGIN)
    url.searchParams.set('utm_source', 'instagram')
    url.searchParams.set('utm_medium', 'social')
    url.searchParams.set('utm_campaign', playCampaign)
    url.searchParams.set(
      'utm_content',
      `${kind}${roundSuffix ? `-${roundSuffix.toLowerCase()}` : ''}`,
    )
    return url.toString()
  }, [playSlug, playCampaign, kind, roundSuffix])

  const [linkCopied, setLinkCopied] = useState(false)

  async function copyPlayLink() {
    try {
      await navigator.clipboard.writeText(playUrl)
    } catch {
      // Clipboard API needs a secure context and permission. Falling back to a
      // throwaway input keeps this working over plain http on a LAN address,
      // which is how the admin is often reached from a phone.
      const input = document.createElement('input')
      input.value = playUrl
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

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
              {ALL_KINDS.map(k => {
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

          {kind === 'upcoming' && (
            <Field label="Round">
              {/* Disabled rather than hidden while the first list is in flight:
                  the rounds come back with the matches, and a control that
                  appears late shifts everything under it. */}
              <select
                value={upRoundEffective}
                disabled={!upList?.data}
                onChange={e => {
                  setUpRound(e.target.value)
                  setUpSelected(null)
                }}
                className="w-full px-3 py-2 text-xs rounded-sm border bg-white disabled:opacity-50"
                style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--chalk-dim)', color: 'var(--ink)' }}
              >
                {upList?.data ? (
                  upList.data.rounds.map(r => (
                    <option key={r.round} value={r.round}>
                      {r.label}
                    </option>
                  ))
                ) : (
                  <option value="">Loading…</option>
                )}
              </select>
            </Field>
          )}

          {kind === 'draw' && (
            <Field
              label={drawLoading || drawList?.error ? 'Matches' : `Highlighted matches — ${drawChosenIds.length}/${drawCap}`}
            >
              <MatchPicker
                loading={drawLoading}
                error={drawList?.error}
                capacity={drawCap}
                chosenIds={drawChosenIds}
                onToggle={toggleDrawMatch}
                onReset={() => setDrawSelected(null)}
                onClear={() => setDrawSelected([])}
                empty="No playable first-round ties in this draw."
                rows={drawMatches.map((m, i) => ({
                  id: m.id,
                  title: (
                    <>
                      {m.a} <span style={{ color: 'var(--muted)' }}>v</span> {m.b}
                    </>
                  ),
                  // Draw position, because there is nothing else true to say: the
                  // first round has no results and no picks yet, and no draw in
                  // this database records a seed (see DrawCard.matches), so the
                  // seed line is present only on the rare one that does.
                  subtitle: [
                    m.seeds.some(s => s != null) ? `Seeds ${m.seeds.map(s => s ?? '—').join(' / ')}` : null,
                    `${i + 1} of ${drawMatches.length} in draw order`,
                  ]
                    .filter(Boolean)
                    .join('  ·  '),
                }))}
              />
            </Field>
          )}

          {/* The count joins the label only once there is a list behind it —
              "0/6" while loading reads as an empty selection rather than an
              unanswered question, and the 6 is wrong too, since capacity depends
              on a podium the fetch has not reported yet. */}
          {needsMatches && (
            <Field label={matchesLoading || matchList?.error ? 'Matches' : `Matches — ${chosenIds.length}/${capacity}`}>
              <MatchPicker
                loading={matchesLoading}
                error={matchList?.error}
                capacity={capacity}
                chosenIds={chosenIds}
                onToggle={toggleMatch}
                onReset={() => setSelected(null)}
                onClear={() => setSelected([])}
                empty="No matches in this round."
                rows={roundMatches.map(m => ({
                  id: m.id,
                  title: (
                    <>
                      {m.winner} <span style={{ color: 'var(--muted)' }}>d.</span> {m.loser}
                    </>
                  ),
                  subtitle: [m.score, m.isUpset ? 'UPSET' : null, pickedLabel(m.pickedCount, m.pickedPct)]
                    .filter(Boolean)
                    .join('  ·  '),
                  alert: m.isUpset,
                }))}
              />
            </Field>
          )}

          {kind === 'upcoming' && (
            <Field label={upLoading || upList?.error ? 'Matches' : `Matches — ${upChosenIds.length}/${upCapacity}`}>
              <MatchPicker
                loading={upLoading}
                error={upList?.error}
                capacity={upCapacity}
                chosenIds={upChosenIds}
                onToggle={toggleUpMatch}
                onReset={() => setUpSelected(null)}
                onClear={() => setUpSelected([])}
                empty="No matches left to play in this round."
                rows={upMatches.map(m => ({
                  id: m.id,
                  title: (
                    <>
                      {m.a} <span style={{ color: 'var(--muted)' }}>v</span> {m.b}
                    </>
                  ),
                  // Spelled out rather than left blank: an empty line reads as a
                  // failed lookup, and "no bracket has picked it" is a fact about
                  // a round the field has not reached yet.
                  subtitle: m.favourite ?? 'No bracket has picked this tie',
                }))}
              />
            </Field>
          )}

          {kind !== 'draw' && kind !== 'upcoming' && (
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

          {/* The other half of the post. The card is only an image — this is the
              link that actually has to reach the story sticker or the bio. */}
          <Field label="Link for the post">
            <div
              className="rounded-sm px-3 py-2"
              style={{
                background: 'white',
                border: '1px solid var(--chalk-dim)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
                lineHeight: 1.6,
                color: 'var(--ink)',
                wordBreak: 'break-all',
              }}
            >
              {playUrl}
            </div>
            <button
              onClick={copyPlayLink}
              className="px-4 py-2.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-90"
              style={{
                background: linkCopied ? 'var(--court)' : 'transparent',
                color: linkCopied ? 'white' : 'var(--court)',
                border: '1px solid var(--court)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {linkCopied ? 'Copied ✓' : 'Copy link'}
            </button>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', lineHeight: 1.6 }}>
              Opens the bracket with no account needed. Tagged to this card, so
              PostHog can tell which post earned the signup.
            </p>
          </Field>
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

interface PickerRow {
  id: string
  /** The matchup. A node, so the recap can mute its "d." and this one its "v". */
  title: React.ReactNode
  /** The evidence line under it. */
  subtitle: string
  /** Renders the subtitle in clay — the recap's upset badge. */
  alert?: boolean
}

/**
 * The checkbox list behind both match pickers.
 *
 * Shared rather than written twice because the two lists have to behave
 * identically to be trustworthy: ticking past capacity must lock in both, and
 * "Reset to first N" has to mean the same thing on a recap as on an up-next
 * card. The rows differ only in what each line says, which is why that is the
 * one thing the caller supplies.
 */
function MatchPicker({
  loading,
  error,
  capacity,
  chosenIds,
  rows,
  empty,
  onToggle,
  onReset,
  onClear,
}: {
  loading: boolean
  error?: string
  capacity: number
  chosenIds: string[]
  rows: PickerRow[]
  empty: string
  onToggle: (id: string) => void
  onReset: () => void
  onClear: () => void
}) {
  if (loading) {
    return (
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>Loading matches…</p>
    )
  }
  if (error) {
    return <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--clay)' }}>{error}</p>
  }

  return (
    <>
      <div
        className="flex flex-col gap-1 overflow-y-auto rounded-sm border bg-white p-1"
        style={{ borderColor: 'var(--chalk-dim)', maxHeight: '17rem' }}
      >
        {rows.map(r => {
          const checked = chosenIds.includes(r.id)
          // At capacity the unticked rows lock rather than silently dropping off
          // the card: the count in the label and the preview stay the same thing.
          const full = !checked && chosenIds.length >= capacity
          return (
            <label
              key={r.id}
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
                onChange={() => onToggle(r.id)}
                className="mt-0.5 flex-shrink-0"
              />
              <span className="min-w-0 flex flex-col">
                <span
                  className="truncate"
                  style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--ink)' }}
                >
                  {r.title}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.6rem',
                    color: r.alert ? 'var(--clay)' : 'var(--muted)',
                  }}
                >
                  {r.subtitle}
                </span>
              </span>
            </label>
          )
        })}
        {rows.length === 0 && (
          <p className="px-2 py-1.5" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
            {empty}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onReset}
          className="text-left"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--court)' }}
        >
          Reset to first {capacity}
        </button>
        <button
          onClick={onClear}
          className="text-left"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}
        >
          Clear
        </button>
      </div>
    </>
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
