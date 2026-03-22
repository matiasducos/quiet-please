'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import JoinPublicButton from './JoinPublicButton'

const TOURNAMENT_TYPES = [
  { value: 'grand_slam', label: 'Grand Slams' },
  { value: 'masters_1000', label: 'Masters 1000' },
  { value: '500', label: '500s' },
  { value: '250', label: '250s' },
] as const

const TYPE_LABELS: Record<string, string> = {
  grand_slam: 'Grand Slams',
  masters_1000: 'Masters 1000',
  '500': '500s',
  '250': '250s',
}

type League = {
  id: string
  name: string
  description: string | null
  ownerName: string
  memberCount: number
  isMember: boolean
  tournamentTypes: string[] | null
}

export default function BrowseFilters({ leagues }: { leagues: League[] }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let result = leagues
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(l => l.name.toLowerCase().includes(q) || l.description?.toLowerCase().includes(q))
    }
    if (typeFilter) {
      result = result.filter(l => !l.tournamentTypes || l.tournamentTypes.includes(typeFilter))
    }
    return result
  }, [leagues, search, typeFilter])

  return (
    <>
      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search leagues…"
          className="flex-1 min-w-[200px] px-4 py-2.5 rounded-sm text-sm outline-none"
          style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
          onFocus={e => e.target.style.borderColor = 'var(--court)'}
          onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
        />
        <div className="flex gap-1.5">
          {TOURNAMENT_TYPES.map(t => {
            const active = typeFilter === t.value
            return (
              <button
                key={t.value}
                onClick={() => setTypeFilter(active ? null : t.value)}
                className="px-2.5 py-1.5 rounded-sm text-xs transition-colors"
                style={{
                  background: active ? '#1e4e8c' : 'white',
                  color: active ? 'white' : 'var(--muted)',
                  border: `1px solid ${active ? '#1e4e8c' : 'var(--chalk-dim)'}`,
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-sm border" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            {search || typeFilter ? 'No leagues match your filters.' : 'No public leagues yet.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(league => (
            <div
              key={league.id}
              className="flex items-center justify-between bg-white rounded-sm border px-6 py-5"
              style={{ borderColor: 'var(--chalk-dim)' }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>{league.name}</span>
                </div>
                {league.description && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{league.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                    by {league.ownerName}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                    {league.memberCount} member{league.memberCount !== 1 ? 's' : ''}
                  </span>
                  {league.tournamentTypes && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#1e4e8c', background: '#edf4fc', padding: '1px 6px', borderRadius: '2px' }}>
                      {league.tournamentTypes.map(t => TYPE_LABELS[t] ?? t).join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 ml-4">
                {league.isMember ? (
                  <Link
                    href={`/leagues/${league.id}`}
                    className="px-4 py-2 text-sm rounded-sm border"
                    style={{ borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none' }}
                  >
                    View
                  </Link>
                ) : (
                  <JoinPublicButton leagueId={league.id} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
