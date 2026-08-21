'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import TournamentCard from './TournamentCard'
import TournamentMonthGroup from './TournamentMonthGroup'

type Season = number | 'all'

interface Props {
  tournaments: any[]
  liveTournaments: any[]
  activeTour: string
  activeStatus: string
  /** The season being shown — already resolved server-side, never null. */
  activeYear: Season
  /** Every season with at least one event on this tour, newest first. */
  seasons: { season: number; tournament_count: number }[]
  /** The calendar year, so the default season can be left out of URLs. */
  currentSeason: number
  /** Seed for the search box, set only by the "search all years" escape hatch. */
  initialQuery?: string
  predictableStatuses?: string[]
}

/**
 * The one place that builds a /tournaments URL.
 *
 * Three call sites used to concatenate this by hand, and each knew about a
 * different subset of the filters — adding a third filter to inline templates
 * is how you end up with a tour switch that silently drops the season.
 *
 * The current season is omitted rather than spelled out: it is what the page
 * shows with no params at all, so leaving it off keeps the common URL clean and
 * keeps `/tournaments` and `/tournaments?year=2026` from being two spellings of
 * the same page in a crawler's eyes.
 */
function tournamentsHref({ tour, status, year, currentSeason, q }: {
  tour: string
  status: string
  year: Season
  currentSeason: number
  q?: string
}) {
  const params = new URLSearchParams()
  if (tour !== 'ATP')   params.set('tour', tour)
  if (status !== 'all') params.set('status', status)
  if (year !== currentSeason) params.set('year', String(year))
  // Only ever set when handing a search term to a different season — typing
  // does not touch the URL, so there is no navigation per keystroke.
  if (q) params.set('q', q)
  const qs = params.toString()
  return qs ? `/tournaments?${qs}` : '/tournaments'
}

const STATUSES = [
  { key: 'all',                   label: 'All'            },
  { key: 'upcoming',              label: 'Upcoming',       color: '#4a5568', bg: '#f3f3f1' },
  { key: 'draw_published',        label: 'Draw published', color: '#185FA5', bg: '#edf2fb' },
  { key: 'accepting_predictions', label: 'Predict now',    color: '#1a6b3c', bg: '#edf7f0' },
  { key: 'in_progress',           label: 'In progress',    color: '#993C1D', bg: '#fdf2ed' },
  { key: 'completed',             label: 'Completed',      color: '#4a5568', bg: '#ebebea' },
]

export default function TournamentsClientList({ tournaments, liveTournaments, activeTour, activeStatus, activeYear, seasons, currentSeason, initialQuery = '', predictableStatuses }: Props) {
  // Seeded, not synced. Changing season changes the Suspense key on the server,
  // which remounts this component — that remount is what picks up a new
  // initialQuery, so no prop-sync effect is needed here.
  const [query, setQuery] = useState(initialQuery)
  const router = useRouter()

  const href = (over: Partial<{ tour: string; status: string; year: Season; q: string }>) =>
    tournamentsHref({ tour: activeTour, status: activeStatus, year: activeYear, currentSeason, ...over })

  const q = query.trim().toLowerCase()
  const filtered = q
    ? tournaments.filter(t => t.name.toLowerCase().includes(q) || t.location?.toLowerCase().includes(q))
    : tournaments

  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const hasQuery = q.length > 0

  // A past season is four or five events spread over as many months, and the
  // current-month rule never fires on one — so without this every historical
  // year opened as a stack of shut accordions with nothing visible at all.
  // Under "All years" the list is long again and the current month rule takes
  // back over.
  const showAllMonthsOpen = filtered.length <= 12

  // Group by calendar month
  const monthMap = new Map<string, { label: string; list: typeof filtered }>()
  for (const t of filtered) {
    let key: string
    let label: string
    if (t.starts_at) {
      const d = new Date(t.starts_at)
      key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    } else {
      key   = '9999-99'
      label = 'Date TBC'
    }
    if (!monthMap.has(key)) monthMap.set(key, { label, list: [] })
    monthMap.get(key)!.list.push(t)
  }

  const groups = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { label, list }]) => ({ key, label, list }))

  // The <select> must always contain its own value, or React renders a blank
  // control. seasons comes from a database read that can legitimately come back
  // empty — before 088 is applied, or if the query errors — so the active year
  // is folded in rather than assumed to be present.
  const seasonOptions = [...new Set([
    ...seasons.map(s => s.season),
    ...(activeYear === 'all' ? [] : [activeYear]),
  ])].sort((a, b) => b - a)
  // Counts come free with the GROUP BY, and they answer the question the picker
  // otherwise leaves open — whether an old season holds a full calendar or the
  // four majors we backfilled.
  const countFor = new Map(seasons.map(s => [s.season, s.tournament_count]))
  const totalSeasonCount = seasons.reduce((n, s) => n + s.tournament_count, 0)

  const activeStatusMeta = STATUSES.find(s => s.key === activeStatus)
  // Empty-state copy has to name the season, or "No completed ATP tournaments"
  // reads as a claim about the whole archive rather than about one year.
  const inSeason = activeYear === 'all' ? '' : ` in ${activeYear}`

  return (
    <>
      {/* ── Header: title, description, then controls ── */}
      <div className="mb-5">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          Tournaments
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem', lineHeight: 1.65, marginTop: '0.4rem' }}>
          Browse every ATP and WTA tournament of the season and submit your bracket before the draw closes. Points you earn count toward the global leaderboard and your season ranking.
        </p>

        {/* Search + season + ATP/WTA.

            Wraps: at 375px the search box and the season picker fill the row on
            their own, so the tour toggle drops to a second line rather than
            squashing the other two. */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search…"
            className="px-3 py-2 text-sm border rounded-sm bg-white"
            style={{
              borderColor: 'var(--chalk-dim)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--ink)',
              width: '160px',
              outline: 'none',
            }}
          />

          {/* Season picker.

              A native <select> rather than a row of chips or a custom popover:
              the season list grows by one every January and is already six
              long, and on a phone the native control is a full-height wheel
              instead of six more things to fit on the row.

              Navigation rather than local state, because the filtering happens
              in the database — the page fetches one season, not all of them.
              That also makes the season shareable in the URL, the same as tour
              and status. */}
          <div className="relative">
            <select
              aria-label="Season"
              value={String(activeYear)}
              onChange={e => {
                const next = e.target.value
                router.push(href({ year: next === 'all' ? 'all' : Number(next) }))
              }}
              className="appearance-none pl-3 pr-8 py-2 text-sm border rounded-sm bg-white cursor-pointer"
              style={{
                borderColor: 'var(--chalk-dim)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--ink)',
                outline: 'none',
              }}
            >
              {seasonOptions.map(year => {
                const n = countFor.get(year)
                return (
                  <option key={year} value={year}>
                    {year}{n ? ` (${n})` : ''}
                  </option>
                )
              })}
              <option value="all">
                All years{totalSeasonCount ? ` (${totalSeasonCount})` : ''}
              </option>
            </select>
            {/* Same glyph the month accordions use, so the two chevrons on the
                page match. pointer-events-none keeps clicks going to the
                select underneath. */}
            <span
              aria-hidden
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--muted)', fontSize: '0.85rem', pointerEvents: 'none' }}
            >
              ▾
            </span>
          </div>

          <div className="flex rounded-sm overflow-hidden border" style={{ borderColor: 'var(--chalk-dim)' }}>
            {(['ATP', 'WTA'] as const).map(tour => (
              <Link
                key={tour}
                href={href({ tour })}
                className="px-6 py-2 text-sm font-medium transition-colors"
                style={{
                  background: activeTour === tour ? 'var(--court)' : 'white',
                  color: activeTour === tour ? 'white' : 'var(--muted)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.05em',
                }}
              >
                {tour}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── Status chips ── */}
      {/*
        Wraps rather than scrolls. Six chips come to 626px against 343px of
        usable width at 375px, so as a scroller it hid three of the six filters
        — "Predict now" was cut mid-word and "In progress" and "Completed" were
        off screen entirely, with `scrollbarWidth: none` removing any hint they
        existed.

        These are independent pills with gaps between them, not a segmented
        control, so unlike the leaderboard scope switch they can simply flow
        onto a second line. `flex-shrink-0` stays: chips should wrap at their
        natural width rather than squash.
      */}
      <div className="flex flex-wrap items-center gap-2 mb-8">
        {STATUSES.map(s => {
          const active = activeStatus === s.key
          const activeColor = (s as any).color ?? 'var(--ink)'
          const activeBg    = (s as any).bg    ?? 'white'
          return (
            <Link
              key={s.key}
              href={href({ status: s.key })}
              className="flex-shrink-0 px-3 py-1.5 text-xs rounded-sm border transition-all"
              style={{
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.04em',
                borderColor: active ? activeColor : 'var(--chalk-dim)',
                background:  active ? activeBg   : 'white',
                color:       active ? activeColor : 'var(--muted)',
                fontWeight:  active ? 600 : 400,
              }}
            >
              {s.label}
            </Link>
          )
        })}
      </div>

      {/* ── Live Right Now ── */}
      {/* The live strip is season-agnostic data (anything in progress right now),
          so it is only honest above a season that could contain it. Browsing
          2023 and being shown a match happening today reads as the year filter
          having failed. */}
      {liveTournaments.length > 0 && activeStatus === 'all' && !hasQuery && (activeYear === 'all' || activeYear === currentSeason) && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: '#c84b31', boxShadow: '0 0 0 3px rgba(200,75,49,0.2)', flexShrink: 0 }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Live right now
            </span>
          </div>
          <div className={`grid gap-3 ${liveTournaments.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            {liveTournaments.map((t: any) => (
              <TournamentCard key={t.id} t={t} predictableStatuses={predictableStatuses} />
            ))}
          </div>
        </div>
      )}

      {/* ── Tournament list ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-24" style={{ color: 'var(--muted)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            {hasQuery
              ? `No results for "${query}"${inSeason}`
              : activeTour === 'WTA'
                ? 'WTA tournaments coming soon'
                : `No ${activeStatusMeta && activeStatus !== 'all' ? `"${activeStatusMeta.label}" ` : ''}${activeTour} tournaments${inSeason}`}
          </p>
          {hasQuery ? (
            /* The search box only ever sees the season the server sent, so an
               empty result is genuinely ambiguous: nothing by that name, or
               nothing by that name *this year*. Widening the search is the
               likelier intent, so it leads — and it carries the query across in
               the URL, because navigating remounts this component and would
               otherwise drop the words the visitor just typed. */
            <div className="flex flex-col items-center gap-2">
              {activeYear !== 'all' && (
                <Link
                  href={href({ year: 'all', q: query })}
                  style={{ fontSize: '0.875rem', color: 'var(--court)' }}
                >
                  Search all years for &ldquo;{query}&rdquo; →
                </Link>
              )}
              <button
                onClick={() => setQuery('')}
                style={{ fontSize: '0.875rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Clear search
              </button>
            </div>
          ) : activeTour === 'WTA' ? (
            <p style={{ fontSize: '0.875rem' }}>
              WTA tournament support is on the way. For now, browse{' '}
              <Link href="/tournaments?tour=ATP" style={{ color: 'var(--court)', textDecoration: 'underline' }}>
                ATP tournaments
              </Link>
              .
            </p>
          ) : activeStatus !== 'all' ? (
            <Link href={href({ status: 'all', year: 'all' })} style={{ color: 'var(--court)', fontSize: '0.875rem' }}>
              View all {activeTour} tournaments →
            </Link>
          ) : activeYear !== 'all' ? (
            <Link href={href({ year: 'all' })} style={{ color: 'var(--court)', fontSize: '0.875rem' }}>
              Browse every season →
            </Link>
          ) : (
            <p style={{ fontSize: '0.875rem' }}>Check back soon — the calendar syncs automatically.</p>
          )}
        </div>
      ) : (
        <>
          {groups.map(group => (
            <TournamentMonthGroup
              key={group.key}
              month={group.label}
              count={group.list.length}
              defaultOpen={hasQuery || showAllMonthsOpen || group.key === currentMonthKey}
            >
              {group.list.map((t: any) => (
                <TournamentCard key={t.id} t={t} predictableStatuses={predictableStatuses} />
              ))}
            </TournamentMonthGroup>
          ))}
        </>
      )}
    </>
  )
}
