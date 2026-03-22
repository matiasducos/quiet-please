'use client'

import { useState } from 'react'
import Link from 'next/link'
import { nameToFlag } from '@/app/admin/countries'

interface UserRow {
  id: string
  username: string
  country: string | null
  points: number
}

interface TournamentBreakdown {
  tournament_id: string
  name: string
  tour: string
  points: number
  flag: string | null
}

const hStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  color: 'var(--muted)',
  letterSpacing: '0.05em',
}

export default function LeaderboardTable({
  users,
  currentUserId,
  breakdownByUser,
  scope,
}: {
  users: UserRow[]
  currentUserId: string
  breakdownByUser: Record<string, TournamentBreakdown[]>
  scope: string
}) {
  const [expandedUser, setExpandedUser] = useState<string | null>(null)

  return (
    <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
        <div className="col-span-1"  style={hStyle}>RANK</div>
        <div className="col-span-8"  style={hStyle}>PLAYER</div>
        <div className="col-span-3 text-right" style={hStyle}>POINTS</div>
      </div>

      {users.length === 0 ? (
        <div className="px-5 py-12 text-center" style={{ color: 'var(--muted)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>No players yet</p>
          <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
            {scope === 'city' || scope === 'country'
              ? 'No players from this area have earned points yet.'
              : 'Be the first to make predictions!'}
          </p>
        </div>
      ) : (
        users.map((u, i) => {
          const isMe = u.id === currentUserId
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
          const isExpanded = expandedUser === u.id
          const breakdown = breakdownByUser[u.id] ?? []

          return (
            <div key={u.id}>
              <div
                className="grid grid-cols-12 px-5 py-4 border-b last:border-0"
                style={{
                  borderColor: 'var(--chalk-dim)',
                  background: isMe ? '#edf4fc' : 'white',
                  cursor: breakdown.length > 0 ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (breakdown.length > 0) {
                    setExpandedUser(isExpanded ? null : u.id)
                  }
                }}
              >
                <div className="col-span-1 flex items-center">
                  {medal ? (
                    <span style={{ fontSize: '1rem' }}>{medal}</span>
                  ) : (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {i + 1}
                    </span>
                  )}
                </div>
                <div className="col-span-8 flex items-center gap-2 min-w-0">
                  <Link
                    href={`/profile/${u.username}`}
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '1rem',
                      color: isMe ? '#1e4e8c' : 'var(--ink)',
                      fontWeight: isMe ? 500 : 400,
                      textDecoration: 'none',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {u.username}
                  </Link>
                  {isMe && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#1e4e8c', background: '#dbeafe', padding: '1px 6px', borderRadius: '2px', flexShrink: 0 }}>
                      you
                    </span>
                  )}
                  {scope === 'worldwide' && u.country && nameToFlag(u.country) && (
                    <span style={{ fontSize: '0.85rem', flexShrink: 0 }} title={u.country}>
                      {nameToFlag(u.country)}
                    </span>
                  )}
                  {breakdown.length > 0 && (
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)',
                      transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 0.15s ease',
                      flexShrink: 0,
                    }}>
                      ▾
                    </span>
                  )}
                </div>
                <div className="col-span-3 flex items-center justify-end">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: u.points > 0 ? 'var(--ink)' : 'var(--muted)' }}>
                    {u.points}
                  </span>
                </div>
              </div>

              {/* Expanded per-tournament breakdown */}
              {isExpanded && breakdown.length > 0 && (
                <div style={{ background: '#fafaf8', borderBottom: '1px solid var(--chalk-dim)', padding: '8px 20px 12px 52px' }}>
                  {breakdown.map((b, bi) => (
                    <div key={bi} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/leaderboard/tournaments/${b.tournament_id}`}
                          onClick={e => e.stopPropagation()}
                          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--ink)', textDecoration: 'none' }}
                          className="hover:underline"
                        >
                          {b.flag && <span style={{ marginRight: '4px' }}>{b.flag}</span>}
                          {b.name}
                        </Link>
                        <span className="px-1.5 py-0.5 rounded-sm" style={{
                          fontFamily: 'var(--font-mono)', fontSize: '0.55rem',
                          background: b.tour === 'WTA' ? '#fbeaf0' : '#e6f1fb',
                          color: b.tour === 'WTA' ? '#993556' : '#185FA5',
                        }}>
                          {b.tour}
                        </span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--court)', fontWeight: 500 }}>
                        +{b.points}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
