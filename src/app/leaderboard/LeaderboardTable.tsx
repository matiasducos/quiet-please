'use client'

import { useState } from 'react'
import Link from 'next/link'
import CountryFlag from '@/components/CountryFlag'
import { formatPoints } from '@/lib/utils/format'
import Tooltip from '@/components/Tooltip'

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
  /** Correct picks in this tournament. Omit if the user made no picks. */
  correctPicks?: number
  /** Total picks made in this tournament (denominator for accuracy). */
  totalPicks?: number
  /** Effective streak multiplier for this tournament. 1.0 = no streak bonus. */
  streakPower?: number
  /**
   * Outside the rolling 52-week window, so it no longer counts toward the total
   * in the row header. Still listed — the record is permanent, only the label
   * changes. Never filter these out.
   */
  expired?: boolean
}

const hStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  color: 'var(--muted)',
  letterSpacing: '0.05em',
}

interface UserStats {
  tournaments: number
  totalPicks: number
  correctPicks: number
  streakPower: number
}

export default function LeaderboardTable({
  users,
  currentUserId,
  breakdownByUser,
  statsByUser,
  scope,
}: {
  users: UserRow[]
  currentUserId: string
  breakdownByUser: Record<string, TournamentBreakdown[]>
  statsByUser: Record<string, UserStats>
  scope: string
}) {
  const [expandedUser, setExpandedUser] = useState<string | null>(null)

  return (
    <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
      {/*
        No horizontal scroller here on purpose.

        This used to be `overflow-x-auto` wrapping `min-w-[500px]`, which at 375px
        offered 159px of side-scroll that revealed nothing at all: PLAYED,
        ACCURACY and STREAK POWER are hidden below `sm:`, and grid drops
        display:none items from placement entirely, so the surviving cells
        collapsed into 7 of the 12 columns while the track stayed pinned at
        500px. Everything past x=305 was blank.

        The fix is to let the three remaining cells own the full width at mobile
        and hand the hidden stats to a caption under the name, so the row fits
        natively instead of being scrolled through.
      */}
      <div className="grid grid-cols-12 px-4 sm:px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
        <div className="col-span-2 sm:col-span-1"  style={hStyle}>RANK</div>
        <div className="col-span-7 sm:col-span-4"  style={hStyle}>PLAYER</div>
        <div className="col-span-1 text-right hidden sm:block" style={hStyle}>PLAYED</div>
        <div className="col-span-2 text-right hidden sm:block" style={hStyle}>ACCURACY</div>
        <div className="col-span-2 text-right hidden sm:block" style={hStyle}>
          <Tooltip text="How much streak multipliers boost your points. 1.0x = no streak bonus, 2.0x = double from streaks.">
            <span style={{ cursor: 'help', borderBottom: '1px dotted var(--muted)' }}>STREAK POWER</span>
          </Tooltip>
        </div>
        <div className="col-span-3 sm:col-span-2 text-right" style={hStyle}>POINTS</div>
      </div>

      {users.length === 0 ? (
        <div className="px-4 sm:px-5 py-12 text-center" style={{ color: 'var(--muted)' }}>
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
          const stats = statsByUser[u.id]
          const accuracy = stats && stats.totalPicks > 0
            ? Math.round((stats.correctPicks / stats.totalPicks) * 100)
            : null

          return (
            <div key={u.id}>
              <div
                className="grid grid-cols-12 px-4 sm:px-5 py-4 border-b last:border-0"
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
                <div className="col-span-2 sm:col-span-1 flex items-center">
                  {medal ? (
                    <span style={{ fontSize: '1rem' }}>{medal}</span>
                  ) : (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {i + 1}
                    </span>
                  )}
                </div>
                <div className="col-span-7 sm:col-span-4 flex flex-col justify-center min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
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
                    {scope === 'worldwide' && u.country && (
                      <CountryFlag country={u.country} size={16} />
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

                  {/*
                    Mobile only. The three stat columns are hidden below `sm:`,
                    and before this they were simply unreachable on a phone —
                    the side-scroll they lived behind led to blank space, not to
                    them. A caption is the honest way to fit them: same numbers,
                    one line, no scrolling.
                  */}
                  {stats && (stats.tournaments > 0 || accuracy !== null) && (
                    <div
                      className="flex sm:hidden items-center gap-1.5 flex-wrap"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.62rem',
                        color: 'var(--muted)',
                        letterSpacing: '0.02em',
                        marginTop: '3px',
                      }}
                    >
                      <span>{stats.tournaments} played</span>
                      {accuracy !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span style={{ color: accuracy >= 50 ? '#166534' : 'var(--muted)' }}>{accuracy}%</span>
                        </>
                      )}
                      {stats.streakPower > 1 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span style={{ color: stats.streakPower >= 1.5 ? '#166534' : 'var(--muted)' }}>
                            {stats.streakPower.toFixed(1)}× streak
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="col-span-1 hidden sm:flex items-center justify-end">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {stats?.tournaments ?? 0}
                  </span>
                </div>
                <div className="col-span-2 hidden sm:flex items-center justify-end">
                  {accuracy !== null ? (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: accuracy >= 50 ? '#166534' : 'var(--muted)' }}>
                      {accuracy}%
                    </span>
                  ) : (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>—</span>
                  )}
                </div>
                <div className="col-span-2 hidden sm:flex items-center justify-end">
                  {stats && stats.streakPower > 0 ? (
                    <Tooltip text="How much streak multipliers boost this player's points. 1.0x = no bonus, 2.0x = double from streaks.">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: stats.streakPower >= 1.5 ? '#166534' : 'var(--muted)', cursor: 'help' }}>
                        {stats.streakPower.toFixed(1)}x
                      </span>
                    </Tooltip>
                  ) : (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>—</span>
                  )}
                </div>
                <div className="col-span-3 sm:col-span-2 flex items-center justify-end">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: u.points > 0 ? 'var(--ink)' : 'var(--muted)' }}>
                    {formatPoints(u.points)}
                  </span>
                </div>
              </div>

              {/* Expanded per-tournament breakdown */}
              {isExpanded && breakdown.length > 0 && (
                <div style={{ background: '#fafaf8', borderBottom: '1px solid var(--chalk-dim)' }}>
                  {breakdown.map((b, bi) => {
                    const tAcc = (b.totalPicks && b.totalPicks > 0 && b.correctPicks != null)
                      ? Math.round((b.correctPicks / b.totalPicks) * 100)
                      : null
                    const tStreak = b.streakPower && b.streakPower > 1 ? b.streakPower : null
                    return (
                      <div
                        key={bi}
                        className="grid grid-cols-12 px-4 sm:px-5 py-1.5 items-center"
                      >
                        {/* Tournament name sits under PLAYER (col 2-5), indented via col-start */}
                        <div className="col-span-8 sm:col-start-2 sm:col-span-4 flex items-center gap-2 flex-wrap min-w-0">
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
                          {b.expired && (
                            <span
                              title="Earned more than 52 weeks ago, so it no longer counts toward the ranking total. The result is kept permanently."
                              className="px-1.5 py-0.5 rounded-sm"
                              style={{
                                fontFamily: 'var(--font-mono)', fontSize: '0.55rem',
                                letterSpacing: '0.06em',
                                background: '#f0ece6', color: 'var(--muted)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              EXPIRED
                            </span>
                          )}
                        </div>
                        {/* PLAYED: picks made */}
                        <div className="col-span-1 hidden sm:flex items-center justify-end">
                          {b.totalPicks != null && b.totalPicks > 0 ? (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>
                              {b.correctPicks}/{b.totalPicks}
                            </span>
                          ) : (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>—</span>
                          )}
                        </div>
                        {/* ACCURACY */}
                        <div className="col-span-2 hidden sm:flex items-center justify-end">
                          {tAcc != null ? (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: tAcc >= 50 ? '#166534' : 'var(--muted)' }}>
                              {tAcc}%
                            </span>
                          ) : (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>—</span>
                          )}
                        </div>
                        {/* STREAK POWER */}
                        <div className="col-span-2 hidden sm:flex items-center justify-end">
                          {tStreak != null ? (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: tStreak >= 1.5 ? '#166534' : 'var(--muted)' }}>
                              {tStreak.toFixed(1)}x
                            </span>
                          ) : (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>—</span>
                          )}
                        </div>
                        {/* POINTS */}
                        <div className="col-span-3 sm:col-span-2 flex items-center justify-end">
                          {/* Expired entries keep their number — it is still what
                              they scored — but drop the "+" and the court green,
                              which would imply it is contributing to the total. */}
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.75rem',
                            color: b.expired ? 'var(--muted)' : 'var(--court)',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                          }}>
                            {b.expired ? '' : '+'}{formatPoints(b.points)}
                          </span>
                        </div>
                        {/* Mobile-only caption: shown below name when sm columns are hidden */}
                        {(tAcc != null || tStreak != null) && (
                          <div className="col-span-12 flex sm:hidden flex-wrap gap-1.5" style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.62rem',
                            color: 'var(--muted)',
                            letterSpacing: '0.02em',
                            marginTop: '2px',
                          }}>
                            {tAcc != null && (
                              <span style={{ color: tAcc >= 50 ? '#166534' : 'var(--muted)' }}>
                                {b.correctPicks}/{b.totalPicks} · {tAcc}%
                              </span>
                            )}
                            {tAcc != null && tStreak != null && <span>·</span>}
                            {tStreak != null && (
                              <span style={{ color: tStreak >= 1.5 ? '#166534' : 'var(--muted)' }}>
                                {tStreak.toFixed(1)}× streak
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
