'use client'

import { useState } from 'react'
import Link from 'next/link'

type BreakdownItem = { tournament_id: string; name: string; tour: string; points: number; flag: string | null }

type Member = {
  user_id: string
  username: string
  total_points: number
  isMe: boolean
  isLeagueOwner: boolean
  breakdown: BreakdownItem[]
}

export default function LeagueLeaderboard({ members, leagueId }: { members: Member[]; leagueId: string }) {
  const [expandedUser, setExpandedUser] = useState<string | null>(null)

  return (
    <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
        <div className="col-span-1" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>RANK</div>
        <div className="col-span-8" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>PLAYER</div>
        <div className="col-span-3 text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>POINTS</div>
      </div>

      {members.map((m, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
        const isExpanded = expandedUser === m.user_id
        const hasBreakdown = m.breakdown.length > 0

        return (
          <div key={m.user_id} className="border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
            <div
              className="grid grid-cols-12 px-5 py-4"
              style={{ background: m.isMe ? '#edf4fc' : 'white', cursor: hasBreakdown ? 'pointer' : 'default' }}
              onClick={() => hasBreakdown && setExpandedUser(isExpanded ? null : m.user_id)}
            >
              <div className="col-span-1 flex items-center">
                {medal ? <span style={{ fontSize: '1rem' }}>{medal}</span>
                  : <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{i + 1}</span>}
              </div>
              <div className="col-span-8 flex items-center gap-2">
                <Link href={`/profile/${m.username}`} onClick={e => e.stopPropagation()} style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: m.isMe ? '#1e4e8c' : 'var(--ink)', textDecoration: 'none' }}>{m.username}</Link>
                {m.isMe && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#1e4e8c', background: '#dbeafe', padding: '1px 6px', borderRadius: '2px' }}>you</span>}
                {m.isLeagueOwner && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', background: 'var(--chalk-dim)', padding: '1px 6px', borderRadius: '2px' }}>owner</span>}
                {hasBreakdown && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', display: 'inline-block' }}>▾</span>
                )}
              </div>
              <div className="col-span-3 flex items-center justify-end">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: m.total_points > 0 ? 'var(--ink)' : 'var(--muted)' }}>{m.total_points}</span>
              </div>
            </div>

            {isExpanded && m.breakdown.length > 0 && (
              <div className="px-5 pb-3" style={{ paddingLeft: '52px', background: '#fafaf8' }}>
                {m.breakdown.map((b, bi) => (
                  <div key={bi} className="flex items-center justify-between py-1.5" style={{ fontSize: '0.8rem' }}>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/leagues/${leagueId}/tournaments/${b.tournament_id}`}
                        onClick={e => e.stopPropagation()}
                        style={{ color: 'var(--ink)', textDecoration: 'none' }}
                        className="hover:underline"
                      >
                        {b.flag && <span style={{ marginRight: '4px' }}>{b.flag}</span>}
                        {b.name}
                      </Link>
                      <span
                        className="px-1.5 py-0.5 rounded-sm"
                        style={{
                          fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
                          background: b.tour === 'WTA' ? '#fbeaf0' : '#e6f1fb',
                          color: b.tour === 'WTA' ? '#993556' : '#185FA5',
                        }}
                      >
                        {b.tour}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--court)', fontWeight: 500 }}>
                      +{b.points}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
