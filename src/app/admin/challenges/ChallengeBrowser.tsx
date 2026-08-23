'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { listChallenges, getChallengeOverview } from './actions'
import type {
  AdminChallengeRow, AdminChallengeOverview, ChallengeStatusFilter, ChallengeKind,
} from './actions'
import type { AdminPredictionTournament } from '../predictions/actions'
import {
  mono, control, ALERT, when, Segmented, Chip, AdminHeader, Pager,
} from '../ui'
import type { ChipTone } from '../ui'

/**
 * How a status should read. `accepted` and `active` are the same state reached
 * by the two different paths (friends vs anonymous), so both render as "live" —
 * the raw value is kept alongside so the underlying row stays recognisable.
 */
const STATUS_TONE: Record<string, ChipTone> = {
  accepted: 'good',
  active: 'good',
  waiting_opponent: 'warn',
  pending: 'warn',
  completed: 'court',
  declined: 'muted',
  cancelled: 'muted',
  expired: 'alert',
}

function statusLabel(status: string) {
  if (status === 'accepted' || status === 'active') return `live · ${status}`
  return status.replace(/_/g, ' ')
}

/** One side of a challenge, with its score. */
function Side({
  name, points, picks, isWinner,
}: {
  name: string | null
  points: number | null
  picks: number | null
  isWinner: boolean
}) {
  return (
    <div className="flex-1 min-w-0">
      <div
        style={{
          ...mono, fontSize: '0.72rem',
          color: isWinner ? 'var(--ink)' : 'var(--muted)',
          fontWeight: isWinner ? 600 : 400,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {isWinner && '🏆 '}
        {name ?? <span style={{ fontStyle: 'italic' }}>nobody yet</span>}
      </div>
      <div style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)' }}>
        {points ?? 0} pts{picks !== null && ` · ${picks} picks`}
      </div>
    </div>
  )
}

function ChallengeCard({ row, showTournament }: { row: AdminChallengeRow; showTournament: boolean }) {
  const decided = row.winnerId !== null
  return (
    <div className="rounded-sm border bg-white px-3 py-2.5" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <Chip text={statusLabel(row.status)} tone={STATUS_TONE[row.status] ?? 'muted'} />
        {row.isAnonymous
          ? <Chip text="anonymous" tone="warn" />
          : <Chip text="friends" />}
        {showTournament && row.tournamentLabel && (
          <span style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)' }}>
            {row.tournamentLabel}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Side
          name={row.challengerName}
          points={row.challengerPoints}
          picks={row.challengerPicks}
          isWinner={decided && row.winnerId === row.challengerId}
        />
        <span style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)', flexShrink: 0 }}>vs</span>
        <Side
          name={row.challengedName}
          points={row.challengedPoints}
          picks={row.challengedPicks}
          isWinner={decided && row.winnerId === row.challengedId}
        />
      </div>

      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2" style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)' }}>
        <span>created {when(row.createdAt)}</span>
        <span>updated {when(row.updatedAt)}</span>
        {row.tournamentStatus && <span>draw {row.tournamentStatus.replace(/_/g, ' ')}</span>}
        {/* The share code is the anonymous challenge's public route key, not a
            secret — the per-side edit tokens are, and are never fetched. */}
        {row.shareCode && (
          <Link href={`/c/${row.shareCode}`} style={{ color: 'var(--court)' }}>
            /c/{row.shareCode}
          </Link>
        )}
      </div>
    </div>
  )
}

export default function ChallengeBrowser({
  tournaments,
}: {
  tournaments: AdminPredictionTournament[]
}) {
  const [tournamentId, setTournamentId] = useState('all')
  const [status, setStatus] = useState<ChallengeStatusFilter>('all')
  const [kind, setKind] = useState<ChallengeKind>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<AdminChallengeRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [overview, setOverview] = useState<AdminChallengeOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listChallenges({ tournamentId, status, kind, search, page })
      setRows(res.rows)
      setHasMore(res.hasMore)
      setPageSize(res.pageSize)
      if (!res.ok) setError(res.error ?? 'Query failed')
    } finally {
      setLoading(false)
    }
  }, [tournamentId, status, kind, search, page])

  useEffect(() => { load() }, [load])

  // The overview ignores the search box, so it reloads only when the set does.
  useEffect(() => {
    let cancelled = false
    getChallengeOverview({ tournamentId, kind }).then(o => { if (!cancelled) setOverview(o) })
    return () => { cancelled = true }
  }, [tournamentId, kind])

  function handleSearch(value: string) {
    if (searchTimer) clearTimeout(searchTimer)
    setSearchTimer(setTimeout(() => { setPage(0); setSearch(value) }, 300))
  }

  function reset<T>(setter: (v: T) => void) {
    return (v: T) => { setPage(0); setter(v) }
  }

  const rangeFrom = rows.length === 0 ? 0 : page * pageSize + 1
  const rangeTo = page * pageSize + rows.length
  const showTournament = tournamentId === 'all'

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <AdminHeader label="Challenges" />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            All Challenges
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Every head-to-head on the app — friends challenges and anonymous
            share-link ones, which are otherwise visible only to the two people in them.
          </p>
        </div>

        <div className="flex flex-col gap-2 mb-4">
          <select
            value={tournamentId}
            onChange={e => { setPage(0); setTournamentId(e.target.value) }}
            style={{ ...control, width: '100%' }}
          >
            <option value="all">All tournaments — newest first</option>
            {tournaments.map(t => (
              <option key={t.id} value={t.id}>
                {[t.flagEmoji, t.location ?? t.name, t.tour, `· ${t.status.replace(/_/g, ' ')}`]
                  .filter(Boolean).join(' ')}
              </option>
            ))}
          </select>

          <input
            type="search"
            placeholder="Search a player on either side…"
            onChange={e => handleSearch(e.target.value)}
            style={{ ...control, width: '100%' }}
          />

          <div className="flex gap-2 flex-wrap">
            <Segmented
              value={status}
              onChange={reset(setStatus)}
              options={[
                { key: 'all', label: 'Any' },
                { key: 'live', label: 'Live' },
                { key: 'pending', label: 'Invited' },
                { key: 'completed', label: 'Done' },
              ]}
            />
            <Segmented
              value={kind}
              onChange={reset(setKind)}
              options={[
                { key: 'all', label: 'All' },
                { key: 'friends', label: 'Friends' },
                { key: 'anonymous', label: 'Anonymous' },
              ]}
            />
          </div>
        </div>

        {overview && (
          <p style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '12px' }}>
            {overview.total.toLocaleString()} challenge{overview.total === 1 ? '' : 's'}
            {' · '}{overview.live.toLocaleString()} live
            {' · '}{overview.pending.toLocaleString()} awaiting a reply
            {' · '}{overview.completed.toLocaleString()} finished
            {' · '}{overview.anonymous.toLocaleString()} anonymous
          </p>
        )}

        {error && (
          <p style={{ ...mono, fontSize: '0.75rem', color: ALERT, marginBottom: '12px' }}>{error}</p>
        )}

        {loading ? (
          <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>No challenges match these filters.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map(r => <ChallengeCard key={r.id} row={r} showTournament={showTournament} />)}
          </div>
        )}

        <Pager
          page={page}
          hasMore={hasMore}
          onPrev={() => setPage(p => Math.max(0, p - 1))}
          onNext={() => setPage(p => p + 1)}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
        />
      </div>
    </main>
  )
}
