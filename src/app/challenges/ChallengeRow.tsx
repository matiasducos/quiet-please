import Link from 'next/link'
import CancelButton from './CancelButton'
import { formatPoints } from '@/lib/utils/format'
import { challengeState, TONE_COLOR } from '@/lib/challenges/status'
import { scopeChip } from '@/lib/challenges/scope'

const mono = { fontFamily: 'var(--font-mono)' } as const

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

export interface ChallengeRowData {
  id: string
  status: string
  scope_round: string | null
  created_at: string
  isChallenger: boolean
  opponentName: string | null
  isWinner: boolean
  isDraw: boolean
  /** Final points on a completed challenge, live points while it runs. */
  myPoints: number
  theirPoints: number
  myPicksOutstanding: boolean
  tournament: { name: string; location: string | null; flag_emoji: string | null }
}

/**
 * One challenge in a list.
 *
 * Shared by /challenges and /challenges/past rather than written twice. The two
 * pages had drifted into different status vocabularies and different layouts
 * for the same row, which is the failure mode the shared status list already
 * exists to prevent.
 */
export default function ChallengeRow({
  c,
  withCancel = false,
}: {
  c: ChallengeRowData
  withCancel?: boolean
}) {
  const state = challengeState({
    status: c.status,
    isChallenger: c.isChallenger,
    isWinner: c.isWinner,
    isDraw: c.isDraw,
    myPoints: c.myPoints,
    theirPoints: c.theirPoints,
    myPicksOutstanding: c.myPicksOutstanding,
  })

  const showScore = c.status === 'completed' || c.status === 'accepted'

  return (
    <div className="flex items-stretch border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
      <Link
        href={`/challenges/${c.id}`}
        className="flex-1 min-w-0 px-4 md:px-5 py-3.5 tournament-card"
        style={{ textDecoration: 'none' }}
      >
        {/* Stacks below sm: at 375px a username, a score and a status label
            cannot share one row without the score wrapping mid-number. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4">
          <div className="min-w-0">
            <div
              style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {c.opponentName ?? 'Unknown player'}
            </div>
            <div
              style={{ fontSize: '0.78rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {c.tournament.flag_emoji && <span style={{ marginRight: '3px' }}>{c.tournament.flag_emoji}</span>}
              {c.tournament.location ?? c.tournament.name}
              {c.scope_round && (
                <span style={{ ...mono, fontSize: '0.68rem', color: 'var(--court)' }}> · {scopeChip(c.scope_round)}</span>
              )}
              <span> · {timeAgo(c.created_at)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {showScore && (
              <span style={{ ...mono, fontSize: '0.85rem', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                {formatPoints(c.myPoints)}
                <span style={{ color: 'var(--muted)' }}> – </span>
                {formatPoints(c.theirPoints)}
              </span>
            )}
            <span
              style={{ ...mono, fontSize: '0.7rem', color: TONE_COLOR[state.tone], letterSpacing: '0.03em', whiteSpace: 'nowrap' }}
            >
              {state.cta ?? state.label}
            </span>
          </div>
        </div>
      </Link>
      {withCancel && (
        <div className="flex items-center flex-shrink-0 pr-3 md:pr-4">
          <CancelButton challengeId={c.id} isDraft={c.status === 'draft'} />
        </div>
      )}
    </div>
  )
}
