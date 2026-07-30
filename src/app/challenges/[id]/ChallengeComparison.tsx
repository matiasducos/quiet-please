'use client'

import { useMemo, useState } from 'react'
import { ROUND_ORDER, ROUND_LABEL } from '@/lib/tennis/my-tournament'
// Import the submodules directly, never the '@/lib/tennis' barrel: that index
// runs `createProvider()` at module load, which throws without TENNIS_API_KEY
// and so cannot be pulled into a client bundle. bracket.ts and types.ts are
// side-effect free. BracketPredictor sidesteps the same trap by redefining
// these helpers inline.
import { isByeMatch } from '@/lib/tennis/bracket'
import type { Draw, DrawMatch, Player } from '@/lib/tennis/types'
import { nameToFlag } from '@/app/admin/countries'
import InfoBubble from '@/components/InfoBubble'

const mono = { fontFamily: 'var(--font-mono)' } as const

const WIN_GREEN = 'var(--court)'
const LOSS_RED  = '#c84b31'

interface Row {
  matchId: string
  round: string
  mine:   string | null
  theirs: string | null
  differs: boolean
  winner: string | null
  decided: boolean
  myPoints: number
  theirPoints: number
}

/**
 * Side-by-side pick comparison for a friends challenge.
 *
 * The bracket tabs answer "what did each of us predict"; a reader still has to
 * hold one bracket in their head while looking at the other to find the places
 * the two actually diverge — which is the only part that decides the challenge.
 * This view collapses that: agreements render as one muted line, disagreements
 * split into two columns, and the default filter hides the agreements entirely.
 *
 * Only rendered once picks are revealed (both locked, or the challenge is over)
 * — the poker rule is enforced by the caller, not here.
 */
export default function ChallengeComparison({
  draw,
  myPicks,
  theirPicks,
  myUsername,
  theirUsername,
  matchResults,
  myMatchPoints,
  theirMatchPoints,
}: {
  draw: Draw
  myPicks: Record<string, string>
  theirPicks: Record<string, string>
  myUsername: string
  theirUsername: string
  matchResults: Record<string, string>
  myMatchPoints: Record<string, { points: number; streakMultiplier: number }>
  theirMatchPoints: Record<string, { points: number; streakMultiplier: number }>
}) {
  const [showAll, setShowAll] = useState(false)

  // Player lookup spans the whole draw on purpose: a pick for a later round
  // names someone who only appears as a first-round entrant, so a per-match
  // lookup would come up empty for exactly the deep picks that matter most.
  const playerById = useMemo(() => {
    const map = new Map<string, Player>()
    for (const m of draw.matches) {
      for (const p of [m.player1, m.player2]) {
        if (p?.externalId) map.set(p.externalId, p)
      }
    }
    return map
  }, [draw.matches])

  const { rows, agreed, different, myCalls, theirCalls } = useMemo(() => {
    const sortedRounds = draw.rounds.slice().sort(
      (a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b),
    )
    const roundRank = new Map(sortedRounds.map((r, i) => [r as string, i]))

    const built: Row[] = []
    for (const m of draw.matches as DrawMatch[]) {
      // A bye is not a contested match — neither player can be credited for it.
      if (isByeMatch(m)) continue
      const mine   = myPicks[m.matchId] ?? null
      const theirs = theirPicks[m.matchId] ?? null
      // Nothing to compare when neither entered a pick.
      if (!mine && !theirs) continue
      const winner = matchResults[m.matchId] ?? null
      built.push({
        matchId: m.matchId,
        round: m.round,
        mine,
        theirs,
        differs: mine !== theirs,
        winner,
        decided: winner !== null,
        myPoints:    myMatchPoints[m.matchId]?.points ?? 0,
        theirPoints: theirMatchPoints[m.matchId]?.points ?? 0,
      })
    }

    built.sort((a, b) => (roundRank.get(a.round) ?? 0) - (roundRank.get(b.round) ?? 0))

    // Split calls: among the matches they disagreed on AND that have a result,
    // who actually called it. Both can be wrong, so these need not sum.
    let myCalls = 0, theirCalls = 0
    for (const r of built) {
      if (!r.differs || !r.decided) continue
      if (r.mine   === r.winner) myCalls++
      if (r.theirs === r.winner) theirCalls++
    }

    return {
      rows: built,
      agreed:    built.filter(r => !r.differs).length,
      different: built.filter(r => r.differs).length,
      myCalls,
      theirCalls,
    }
  }, [draw, myPicks, theirPicks, matchResults, myMatchPoints, theirMatchPoints])

  const visible = showAll ? rows : rows.filter(r => r.differs)

  const label = (id: string | null) => {
    if (!id) return 'No pick'
    return playerById.get(id)?.name ?? 'Unknown player'
  }
  const flagOf = (id: string | null) => {
    if (!id) return null
    return nameToFlag(playerById.get(id)?.country ?? null)
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
        <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>
          Neither of you made any picks for this tournament.
        </p>
      </div>
    )
  }

  // Group the visible rows by round, preserving the round ordering above.
  const grouped: Array<{ round: string; rows: Row[] }> = []
  for (const r of visible) {
    const last = grouped[grouped.length - 1]
    if (last && last.round === r.round) last.rows.push(r)
    else grouped.push({ round: r.round, rows: [r] })
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Summary ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <Stat label="Same pick" value={String(agreed)} />
        <Stat label="Different" value={String(different)} />
        <Stat
          label="Split calls"
          value={`${myCalls}–${theirCalls}`}
          tone={myCalls > theirCalls ? WIN_GREEN : theirCalls > myCalls ? LOSS_RED : undefined}
        />
      </div>

      {/* ── Filter ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Toggle active={!showAll} onClick={() => setShowAll(false)} label={`Differences (${different})`} />
        <Toggle active={showAll}  onClick={() => setShowAll(true)}  label={`All (${rows.length})`} />
        <span className="ml-auto flex items-center">
          <InfoBubble label="comparison">
            Every match where at least one of you made a pick. <strong>Same pick</strong> is where you
            both backed the same player; <strong>different</strong> includes matches where one of you
            picked and the other left it blank. <strong>Split calls</strong> counts only the matches
            you disagreed on that have since been played — {myUsername} first, then {theirUsername}.
            They need not add up, because you can both be wrong about the same match.
          </InfoBubble>
        </span>
      </div>

      {/* ── Column headers ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="flex items-center" style={{ background: 'var(--chalk)', borderBottom: '1px solid var(--chalk-dim)' }}>
          <span style={{ ...mono, fontSize: '0.6rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink)', flex: 1, minWidth: 0, padding: '7px 8px 7px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {myUsername}
          </span>
          <span style={{ ...mono, fontSize: '0.6rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted)', flex: 1, minWidth: 0, padding: '7px 10px 7px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {theirUsername}
          </span>
        </div>

        {visible.length === 0 ? (
          <p style={{ ...mono, fontSize: '0.75rem', color: 'var(--muted)', padding: '16px 12px' }}>
            You picked identically on every match — no differences to show.
          </p>
        ) : grouped.map(g => (
          <div key={g.round}>
            <div style={{ ...mono, fontSize: '0.58rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', background: '#fafaf8', padding: '5px 10px', borderBottom: '1px solid var(--chalk-dim)' }}>
              {ROUND_LABEL[g.round] ?? g.round}
            </div>
            {g.rows.map(r => (
              <div key={r.matchId} className="flex items-stretch" style={{ borderBottom: '1px solid var(--chalk-dim)' }}>
                {r.differs ? (
                  <>
                    <Side name={label(r.mine)}   flag={flagOf(r.mine)}   blank={!r.mine}   correct={r.decided ? r.mine === r.winner : null}   points={r.myPoints} first />
                    <span style={{ width: '1px', background: 'var(--chalk-dim)', flexShrink: 0 }} />
                    <Side name={label(r.theirs)} flag={flagOf(r.theirs)} blank={!r.theirs} correct={r.decided ? r.theirs === r.winner : null} points={r.theirPoints} />
                  </>
                ) : (
                  /* Agreed — one line rather than the same name twice. */
                  <span className="flex items-center gap-1.5" style={{ flex: 1, minWidth: 0, padding: '9px 10px' }}>
                    <Mark correct={r.decided ? r.mine === r.winner : null} />
                    <span aria-hidden="true" style={{ fontSize: '0.8rem', lineHeight: 1, flexShrink: 0 }}>{flagOf(r.mine) ?? ''}</span>
                    <span style={{ ...mono, fontSize: '0.72rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {label(r.mine)}
                    </span>
                    {/* Identical picks earn identical points, so one figure covers both. */}
                    {r.myPoints > 0 && (
                      <span style={{ ...mono, fontSize: '0.6rem', color: WIN_GREEN, flexShrink: 0, marginLeft: 'auto' }}>
                        +{r.myPoints}
                      </span>
                    )}
                    <span style={{ ...mono, fontSize: '0.6rem', color: 'var(--muted)', flexShrink: 0, marginLeft: r.myPoints > 0 ? '8px' : 'auto' }}>
                      both
                    </span>
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-sm border p-2.5 md:p-3" style={{ background: 'white', borderColor: 'var(--chalk-dim)' }}>
      <p style={{ ...mono, fontSize: '0.58rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '3px' }}>
        {label}
      </p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', lineHeight: 1.1, color: tone ?? 'var(--ink)' }}>
        {value}
      </p>
    </div>
  )
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...mono,
        fontSize: '0.68rem',
        letterSpacing: '0.03em',
        padding: '5px 10px',
        borderRadius: '2px',
        border: `1px solid ${active ? 'var(--court)' : 'var(--chalk-dim)'}`,
        background: active ? 'var(--court)' : 'white',
        color: active ? 'white' : 'var(--muted)',
      }}
    >
      {label}
    </button>
  )
}

/** null = not played yet, so neither a tick nor a cross would be honest. */
function Mark({ correct }: { correct: boolean | null }) {
  if (correct === null) {
    return <span aria-label="not played yet" style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0, width: '11px' }}>·</span>
  }
  return (
    <span
      aria-label={correct ? 'correct' : 'wrong'}
      style={{ ...mono, fontSize: '0.7rem', color: correct ? WIN_GREEN : LOSS_RED, flexShrink: 0, width: '11px' }}
    >
      {correct ? '✓' : '✕'}
    </span>
  )
}

function Side({ name, flag, blank, correct, points, first = false }: {
  name: string
  flag: string | null
  blank: boolean
  correct: boolean | null
  points: number
  /** Left column gets the outer gutter so both sides align with the header. */
  first?: boolean
}) {
  return (
    <span
      className="flex items-center gap-1.5"
      style={{
        flex: 1,
        minWidth: 0,
        padding: first ? '9px 8px 9px 10px' : '9px 10px 9px 8px',
        // Tint only decided rows: an undecided pick is not yet right or wrong.
        background: correct === true ? '#eaf3de' : correct === false ? '#fdf1ee' : 'transparent',
      }}
    >
      <Mark correct={blank ? null : correct} />
      <span aria-hidden="true" style={{ fontSize: '0.8rem', lineHeight: 1, flexShrink: 0 }}>{flag ?? ''}</span>
      <span
        style={{
          ...mono,
          fontSize: '0.72rem',
          color: blank ? 'var(--muted)' : 'var(--ink)',
          fontStyle: blank ? 'italic' : 'normal',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      {points > 0 && (
        <span style={{ ...mono, fontSize: '0.6rem', color: WIN_GREEN, flexShrink: 0, marginLeft: 'auto' }}>
          +{points}
        </span>
      )}
    </span>
  )
}
