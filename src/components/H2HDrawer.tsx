'use client'

import { useEffect, useState } from 'react'
import CountryFlag from './CountryFlag'
import { getH2HData, type H2HData } from '@/lib/tennis/h2h'
import type { Surface } from '@/lib/tennis/types'

// ── Types ────────────────────────────────────────────────────

interface H2HPlayer {
  externalId: string
  name: string
  country: string
  seed?: number
}

interface H2HDrawerProps {
  player1: H2HPlayer
  player2: H2HPlayer
  surface: Surface | null
  onClose: () => void
}

// ── Surface colors (matches TournamentResultsTable) ──────────

const SURFACE_META: Record<Surface, { bg: string; text: string; label: string }> = {
  hard:  { bg: '#edf2fb', text: '#185FA5', label: 'Hard' },
  clay:  { bg: '#fdf2ed', text: '#993C1D', label: 'Clay' },
  grass: { bg: '#edf7f0', text: '#1a6b3c', label: 'Grass' },
}

// ── Component ────────────────────────────────────────────────

export default function H2HDrawer({ player1, player2, surface, onClose }: H2HDrawerProps) {
  const [data, setData] = useState<H2HData | null>(null)
  const [loading, setLoading] = useState(true)

  // Fetch H2H data
  useEffect(() => {
    setLoading(true)
    getH2HData(player1.externalId, player2.externalId, player1.name, player2.name)
      .then(setData)
      .finally(() => setLoading(false))
  }, [player1.externalId, player2.externalId, player1.name, player2.name])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const total = data ? data.player1Wins + data.player2Wins : 0
  const p1Pct = total > 0 && data ? Math.round((data.player1Wins / total) * 100) : 50

  return (
    <>
      {/* Backdrop */}
      <div
        className="h2h-backdrop fixed inset-0 hidden md:block"
        style={{ zIndex: 60, background: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="h2h-panel fixed top-0 right-0 bottom-0 w-full md:w-[400px] overflow-y-auto"
        style={{ zIndex: 61, background: '#fafaf8', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
      >
        {/* ── Header ─────────────────────────────── */}
        <div className="sticky top-0 px-4 py-3 border-b flex items-center justify-between" style={{ background: '#fafaf8', borderColor: 'var(--chalk-dim)', zIndex: 1 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Head to Head
          </span>
          <button
            onClick={onClose}
            className="flex items-center justify-center"
            style={{ width: 28, height: 28, borderRadius: '4px', color: 'var(--muted)', fontSize: '1.1rem', lineHeight: 1, border: '1px solid var(--chalk-dim)', background: 'white' }}
          >
            ×
          </button>
        </div>

        {/* ── Player names ────────────────────────── */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between gap-3">
            <PlayerLabel player={player1} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.1em', flexShrink: 0 }}>VS</span>
            <PlayerLabel player={player2} align="right" />
          </div>
        </div>

        {loading ? <LoadingSkeleton /> : data ? (
          <>
            {/* ── Overall record ───────────────── */}
            <Section title="Overall Record">
              {total === 0 ? (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center', padding: '12px 0' }}>
                  No previous meetings
                </p>
              ) : (
                <>
                  {/* Score */}
                  <div className="flex items-center justify-between mb-2">
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, color: data.player1Wins >= data.player2Wins ? 'var(--ink)' : 'var(--muted)' }}>
                      {data.player1Wins}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
                      {total} {total === 1 ? 'MATCH' : 'MATCHES'}
                    </span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, color: data.player2Wins >= data.player1Wins ? 'var(--ink)' : 'var(--muted)' }}>
                      {data.player2Wins}
                    </span>
                  </div>

                  {/* Bar */}
                  <div className="flex rounded-sm overflow-hidden" style={{ height: 8 }}>
                    <div style={{ width: `${p1Pct}%`, background: 'var(--court)', transition: 'width 0.3s ease' }} />
                    <div style={{ flex: 1, background: 'var(--chalk-dim)' }} />
                  </div>

                  {/* Labels */}
                  <div className="flex items-center justify-between mt-1.5">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--court)' }}>{p1Pct}%</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)' }}>{100 - p1Pct}%</span>
                  </div>
                </>
              )}
            </Section>

            {/* ── Surface breakdown ────────────── */}
            {total > 0 && (
              <Section title="By Surface">
                <div className="flex flex-col gap-1.5">
                  {data.surfaceBreakdown.map(({ surface: s, player1Wins: w1, player2Wins: w2 }) => {
                    const meta = SURFACE_META[s]
                    const isActive = s === surface
                    const matchesPlayed = w1 + w2
                    return (
                      <div
                        key={s}
                        className="flex items-center justify-between px-3 py-2 rounded-sm"
                        style={{
                          background: isActive ? meta.bg : 'white',
                          border: isActive ? `1px solid ${meta.text}20` : '1px solid var(--chalk-dim)',
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block rounded-sm px-1.5 py-0.5"
                            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.04em', color: meta.text, background: meta.bg, fontWeight: 600 }}
                          >
                            {meta.label.toUpperCase()}
                          </span>
                          {isActive && (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', color: meta.text, opacity: 0.7 }}>
                              THIS TOURNAMENT
                            </span>
                          )}
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: matchesPlayed > 0 ? 'var(--ink)' : 'var(--muted)', fontWeight: 600 }}>
                          {w1}–{w2}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* ── Recent matches ───────────────── */}
            {data.recentMatches.length > 0 && (
              <Section title={`Last ${data.recentMatches.length} Meeting${data.recentMatches.length > 1 ? 's' : ''}`}>
                <div className="flex flex-col gap-2">
                  {data.recentMatches.map((m, i) => {
                    const meta = SURFACE_META[m.surface]
                    const date = new Date(m.date)
                    const dateStr = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                    const isP1Winner = m.winner === data.player1Name

                    return (
                      <div key={i} className="px-3 py-2.5 rounded-sm" style={{ background: 'white', border: '1px solid var(--chalk-dim)' }}>
                        {/* Top row: tournament + surface + round */}
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--muted)' }}>{dateStr}</span>
                          <span style={{ color: 'var(--chalk-dim)' }}>·</span>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.75rem', color: 'var(--ink)', fontWeight: 500 }} className="truncate">
                            {m.tournament}
                          </span>
                          <span
                            className="inline-block rounded-sm px-1 py-px flex-shrink-0"
                            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', color: meta.text, background: meta.bg }}
                          >
                            {meta.label[0]}
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--muted)', flexShrink: 0 }}>{m.round}</span>
                        </div>

                        {/* Winner line */}
                        <div className="flex items-center justify-between">
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.8rem', color: 'var(--ink)', fontWeight: 600 }}>
                            {m.winner === data.player1Name ? getLastName(data.player1Name) : getLastName(data.player2Name)}
                            {' '}
                            <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '0.7rem' }}>def.</span>
                            {' '}
                            {m.winner === data.player1Name ? getLastName(data.player2Name) : getLastName(data.player1Name)}
                          </span>
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.65rem',
                            color: isP1Winner ? 'var(--court)' : 'var(--muted)',
                            fontWeight: 600,
                            flexShrink: 0,
                            marginLeft: 8,
                          }}>
                            {m.score}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* Mock data notice */}
            <div className="px-4 pb-6 pt-2">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--muted)', textAlign: 'center', letterSpacing: '0.04em' }}>
                SAMPLE DATA — REAL H2H STATS COMING SOON
              </p>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}

// ── Sub-components ───────────────────────────────────────────

function PlayerLabel({ player, align = 'left' }: { player: H2HPlayer; align?: 'left' | 'right' }) {
  return (
    <div className={`flex items-center gap-1.5 min-w-0 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      {player.country && <CountryFlag country={player.country} size={16} />}
      <span className="truncate" style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', fontWeight: 600, color: 'var(--ink)' }}>
        {getLastName(player.name)}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
      <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <div className="skeleton rounded-sm" style={{ height: 48, width: '100%' }} />
      <div className="skeleton rounded-sm" style={{ height: 8, width: '100%' }} />
      <div className="skeleton rounded-sm" style={{ height: 36, width: '60%' }} />
      <div className="flex flex-col gap-2 mt-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton rounded-sm" style={{ height: 40, width: '100%' }} />
        ))}
      </div>
      <div className="flex flex-col gap-2 mt-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton rounded-sm" style={{ height: 56, width: '100%' }} />
        ))}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

function getLastName(fullName: string): string {
  const parts = fullName.split(' ')
  if (parts.length <= 1) return fullName
  // "J. Lehecka" → "Lehecka", "Carlos Alcaraz" → "Alcaraz"
  return parts[parts.length - 1]
}
