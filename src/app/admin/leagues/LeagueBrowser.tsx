'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { listLeagues } from './actions'
import type {
  AdminLeagueRow, LeagueVisibility, LeagueStatus, LeagueSort,
} from './actions'
import {
  mono, control, ALERT, when, Segmented, Chip, AdminHeader, MigrationNotice, Pager,
} from '../ui'

function LeagueCard({ league }: { league: AdminLeagueRow }) {
  const restricted =
    (league.allowedTournamentTypes?.length ?? 0) > 0 ||
    (league.allowedSurfaces?.length ?? 0) > 0

  return (
    <div className="rounded-sm border bg-white px-3 py-2.5" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span style={{ ...mono, fontSize: '0.78rem', color: 'var(--ink)' }}>{league.name}</span>
            {league.isPublic
              ? <Chip text="public" tone="court" />
              : <Chip text="private" />}
            {!league.isActive && <Chip text="inactive" tone="alert" />}
            {restricted && <Chip text="restricted" tone="warn" />}
            {/* Leaving a league you own hands ownership on (022), so an owner
                who is not in their own roster is a state worth surfacing. */}
            {!league.ownerIsMember && <Chip text="owner not a member" tone="warn" />}
          </div>
          <div style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            run by {league.ownerUsername ?? 'unknown'} · code {league.inviteCode}
          </div>
        </div>

        <Link
          href={`/admin/leagues/${league.id}`}
          className="px-2 py-1 rounded-sm border transition-opacity hover:opacity-70 flex-shrink-0"
          style={{ ...mono, fontSize: '0.65rem', borderColor: 'var(--chalk-dim)', color: 'var(--ink)', background: 'white' }}
        >
          View members
        </Link>
      </div>

      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5" style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)' }}>
        <span style={{ color: league.memberCount === 0 ? ALERT : 'var(--ink)' }}>
          {league.memberCount} member{league.memberCount === 1 ? '' : 's'}
        </span>
        <span>{league.totalPoints.toLocaleString()} pts total</span>
        <span>last join {when(league.lastJoinedAt)}</span>
        <span>created {when(league.createdAt)}</span>
      </div>

      {restricted && (
        <div className="mt-1" style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)' }}>
          {(league.allowedTournamentTypes?.length ?? 0) > 0 && (
            <span>types: {league.allowedTournamentTypes!.join(', ')} </span>
          )}
          {(league.allowedSurfaces?.length ?? 0) > 0 && (
            <span>surfaces: {league.allowedSurfaces!.join(', ')}</span>
          )}
        </div>
      )}
    </div>
  )
}

export default function LeagueBrowser() {
  const [visibility, setVisibility] = useState<LeagueVisibility>('all')
  const [status, setStatus] = useState<LeagueStatus>('active')
  const [sort, setSort] = useState<LeagueSort>('members')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<AdminLeagueRow[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [migrationMissing, setMigrationMissing] = useState(false)
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listLeagues({ search, visibility, status, sort, page })
      setRows(res.rows)
      setTotal(res.total)
      setPageSize(res.pageSize)
      setMigrationMissing(Boolean(res.migrationMissing))
      if (!res.ok && !res.migrationMissing) setError(res.error ?? 'Query failed')
    } finally {
      setLoading(false)
    }
  }, [search, visibility, status, sort, page])

  useEffect(() => { load() }, [load])

  function handleSearch(value: string) {
    if (searchTimer) clearTimeout(searchTimer)
    setSearchTimer(setTimeout(() => { setPage(0); setSearch(value) }, 300))
  }

  // Any filter change invalidates the page number — page 4 of a new set is
  // meaningless, and past the end there is nothing to show.
  function reset<T>(setter: (v: T) => void) {
    return (v: T) => { setPage(0); setter(v) }
  }

  const rangeFrom = rows.length === 0 ? 0 : page * pageSize + 1
  const rangeTo = page * pageSize + rows.length
  const hasMore = rangeTo < total

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <AdminHeader label="Leagues" />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            All Leagues
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Every league on the app, private ones included — those are visible only
            to their own members everywhere else.
          </p>
        </div>

        {migrationMissing ? (
          <MigrationNotice file="089_admin_league_overview.sql" />
        ) : (
          <>
            <div className="flex flex-col gap-2 mb-4">
              <input
                type="search"
                placeholder="Search league name, owner, or invite code…"
                onChange={e => handleSearch(e.target.value)}
                style={{ ...control, width: '100%' }}
              />

              <div className="flex gap-2 flex-wrap">
                <Segmented
                  value={status}
                  onChange={reset(setStatus)}
                  options={[
                    { key: 'active', label: 'Active' },
                    { key: 'inactive', label: 'Inactive' },
                    { key: 'all', label: 'Any state' },
                  ]}
                />
                <Segmented
                  value={visibility}
                  onChange={reset(setVisibility)}
                  options={[
                    { key: 'all', label: 'All' },
                    { key: 'public', label: 'Public' },
                    { key: 'private', label: 'Private' },
                  ]}
                />
                <Segmented
                  value={sort}
                  onChange={reset(setSort)}
                  options={[
                    { key: 'members', label: 'Members' },
                    { key: 'newest', label: 'Newest' },
                    { key: 'name', label: 'A–Z' },
                  ]}
                />
              </div>
            </div>

            <p style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '12px' }}>
              {total.toLocaleString()} league{total === 1 ? '' : 's'} match these filters
            </p>

            {error && (
              <p style={{ ...mono, fontSize: '0.75rem', color: ALERT, marginBottom: '12px' }}>{error}</p>
            )}

            {loading ? (
              <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>Loading…</p>
            ) : rows.length === 0 ? (
              <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>No leagues match these filters.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {rows.map(l => <LeagueCard key={l.id} league={l} />)}
              </div>
            )}

            <Pager
              page={page}
              hasMore={hasMore}
              onPrev={() => setPage(p => Math.max(0, p - 1))}
              onNext={() => setPage(p => p + 1)}
              rangeFrom={rangeFrom}
              rangeTo={rangeTo}
              total={total}
            />
          </>
        )}
      </div>
    </main>
  )
}
