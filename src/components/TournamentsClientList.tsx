'use client'

import { useState } from 'react'
import Link from 'next/link'
import TournamentCard from './TournamentCard'
import TournamentMonthGroup from './TournamentMonthGroup'

interface Props {
  tournaments: any[]
  liveTournaments: any[]
  activeTour: string
  activeStatus: string
  predictableStatuses?: string[]
}

const STATUSES = [
  { key: 'all',                   label: 'All'            },
  { key: 'upcoming',              label: 'Upcoming',       color: '#4a5568', bg: '#f3f3f1' },
  { key: 'draw_published',        label: 'Draw published', color: '#185FA5', bg: '#edf2fb' },
  { key: 'accepting_predictions', label: 'Predict now',    color: '#1a6b3c', bg: '#edf7f0' },
  { key: 'in_progress',           label: 'In progress',    color: '#993C1D', bg: '#fdf2ed' },
  { key: 'completed',             label: 'Completed',      color: '#4a5568', bg: '#ebebea' },
]

export default function TournamentsClientList({ tournaments, liveTournaments, activeTour, activeStatus, predictableStatuses }: Props) {
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filtered = q
    ? tournaments.filter(t => t.name.toLowerCase().includes(q) || t.location?.toLowerCase().includes(q))
    : tournaments

  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const hasQuery = q.length > 0

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

  const activeStatusMeta = STATUSES.find(s => s.key === activeStatus)

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

        {/* Search + ATP/WTA */}
        <div className="flex items-center gap-2 mt-4">
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

          <div className="flex rounded-sm overflow-hidden border" style={{ borderColor: 'var(--chalk-dim)' }}>
            {(['ATP', 'WTA'] as const).map(tour => (
              <Link
                key={tour}
                href={`/tournaments?tour=${tour}${activeStatus !== 'all' ? `&status=${activeStatus}` : ''}`}
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
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {STATUSES.map(s => {
          const active = activeStatus === s.key
          const activeColor = (s as any).color ?? 'var(--ink)'
          const activeBg    = (s as any).bg    ?? 'white'
          return (
            <Link
              key={s.key}
              href={`/tournaments?tour=${activeTour}${s.key !== 'all' ? `&status=${s.key}` : ''}`}
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
      {liveTournaments.length > 0 && activeStatus === 'all' && !hasQuery && (
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
              ? `No results for "${query}"`
              : `No ${activeStatusMeta && activeStatus !== 'all' ? `"${activeStatusMeta.label}" ` : ''}${activeTour} tournaments`}
          </p>
          {hasQuery ? (
            <button
              onClick={() => setQuery('')}
              style={{ fontSize: '0.875rem', color: 'var(--court)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Clear search
            </button>
          ) : activeStatus !== 'all' ? (
            <Link href={`/tournaments?tour=${activeTour}`} style={{ color: 'var(--court)', fontSize: '0.875rem' }}>
              View all {activeTour} tournaments →
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
              defaultOpen={hasQuery || group.key === currentMonthKey}
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
