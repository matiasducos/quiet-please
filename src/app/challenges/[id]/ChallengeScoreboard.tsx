import Link from 'next/link'
import { formatPoints } from '@/lib/utils/format'

const mono = { fontFamily: 'var(--font-mono)' } as const

const WIN = 'var(--court)'
const LOSS = '#c84b31'

/**
 * The live standing of an accepted challenge.
 *
 * Both scores are always shown. They used to be hidden until both players had
 * locked, which cost the page its only reason to be opened during a tournament
 * and protected nothing: `points_earned` can only accrue from matches that have
 * already been played, so a score gives away nothing an opponent could copy.
 * The picks themselves are what stay concealed, and only while undecided — see
 * the reveal note in page.tsx.
 *
 * Pick counts are always shown for the same reason, plus one of its own: a
 * ten-pick bracket against a sixty-pick one is not a contest, and hiding that
 * from both players until it was too late to fix was the worst of both worlds.
 */
export default function ChallengeScoreboard({
  myUsername,
  theirUsername,
  myPoints,
  theirPoints,
  myPickCount,
  theirPickCount,
  scopeTotal,
  myOutstanding,
  hiddenCount,
  predictHref,
}: {
  myUsername: string
  theirUsername: string
  myPoints: number
  theirPoints: number
  myPickCount: number
  theirPickCount: number
  /** Contested matches in scope, or null when the draw could not be read. */
  scopeTotal: number | null
  myOutstanding: number
  /** Opponent picks still face-down because their match has not been played. */
  hiddenCount: number
  predictHref: string
}) {
  const nothingScoredYet = myPoints === 0 && theirPoints === 0
  const standing = nothingScoredYet
    ? { text: 'No points yet', color: 'var(--muted)' }
    : myPoints > theirPoints
      ? { text: 'Ahead', color: WIN }
      : theirPoints > myPoints
        ? { text: 'Behind', color: LOSS }
        : { text: 'Level', color: 'var(--ink)' }

  return (
    <div className="bg-white rounded-sm border p-4 md:p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="flex items-center justify-between mb-4">
        <span style={{ ...mono, fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Live score
        </span>
        <span style={{ ...mono, fontSize: '0.66rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: standing.color }}>
          {standing.text}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <Side
          name={`${myUsername} (you)`}
          points={myPoints}
          pickCount={myPickCount}
          scopeTotal={scopeTotal}
          leading={!nothingScoredYet && myPoints > theirPoints}
          trailing={!nothingScoredYet && myPoints < theirPoints}
        />
        <Side
          name={theirUsername}
          points={theirPoints}
          pickCount={theirPickCount}
          scopeTotal={scopeTotal}
          leading={!nothingScoredYet && theirPoints > myPoints}
          trailing={!nothingScoredYet && theirPoints < myPoints}
        />
      </div>

      {hiddenCount > 0 && (
        <p style={{ ...mono, fontSize: '0.66rem', color: 'var(--muted)', lineHeight: 1.6, marginTop: '1rem' }}>
          {hiddenCount} of {theirUsername}&apos;s pick{hiddenCount === 1 ? ' is' : 's are'} still face-down.
          Each one turns over when its match is played.
        </p>
      )}

      {myOutstanding > 0 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: '0.75rem', lineHeight: 1.6 }}>
            You have <strong style={{ color: 'var(--ink)' }}>{myOutstanding}</strong> match{myOutstanding === 1 ? '' : 'es'} left to pick.
            An unpicked match cannot score.
          </p>
          <Link
            href={predictHref}
            className="inline-block w-full sm:w-auto text-center px-5 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
            style={{ background: 'var(--court)', textDecoration: 'none' }}
          >
            Make your picks →
          </Link>
        </div>
      )}
    </div>
  )
}

function Side({
  name, points, pickCount, scopeTotal, leading, trailing,
}: {
  name: string
  points: number
  pickCount: number
  scopeTotal: number | null
  leading: boolean
  trailing: boolean
}) {
  const pct = scopeTotal && scopeTotal > 0 ? Math.min(100, (pickCount / scopeTotal) * 100) : 0
  return (
    <div>
      {/* gap-3 rather than justify-between alone: at 375px a long username and a
          four-digit score meet in the middle, and the score must not wrap. */}
      <div className="flex items-baseline justify-between gap-3">
        <span
          style={{ fontSize: '0.85rem', color: 'var(--ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {name}
        </span>
        <span style={{ ...mono, fontSize: '1rem', flexShrink: 0, color: leading ? WIN : trailing ? LOSS : 'var(--ink)' }}>
          {formatPoints(points)} <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>pts</span>
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        {scopeTotal !== null && (
          <span aria-hidden="true" style={{ flex: 1, height: '3px', background: 'var(--chalk-dim)', borderRadius: '2px', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--court)', opacity: 0.55 }} />
          </span>
        )}
        <span style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)', flexShrink: 0 }}>
          {pickCount}{scopeTotal !== null ? `/${scopeTotal}` : ''} picked
        </span>
      </div>
    </div>
  )
}
