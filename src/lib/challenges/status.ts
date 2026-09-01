/**
 * Which challenge statuses belong in "Past challenges".
 *
 * `expired` and `cancelled` are deliberately absent — see
 * NON_EVENT_CHALLENGE_STATUSES. Neither ever produced a bracket or a score, so
 * listing them only pads the history with things that never happened. Cancelling
 * a challenge you sent therefore removes it from the page outright rather than
 * filing it under history.
 *
 * Shared because `/challenges` filters this list in memory while
 * `/challenges/past` pushes it to the database — two copies would drift and the
 * "See all →" page would start showing rows the parent page hides.
 */
export const PAST_CHALLENGE_STATUSES = ['completed', 'declined'] as const

/**
 * Statuses that mean the challenge never actually happened: the opponent never
 * answered (`expired`), or the challenger pulled it back (`cancelled`). Excluded
 * from the Total stat as well as from the list.
 */
export const NON_EVENT_CHALLENGE_STATUSES = ['cancelled', 'expired'] as const

/**
 * A challenge the challenger has created but not yet sent. Invisible to the
 * other side, and the only status a challenger may still add picks to before
 * the opponent knows anything about it — see migration 103.
 */
export const DRAFT_STATUS = 'draft'

/** Statuses that occupy the one-active-challenge-per-pair slot (index 103). */
export const OCCUPYING_STATUSES = ['draft', 'pending', 'accepted'] as const

// ── One status vocabulary ───────────────────────────────────────────────────

/**
 * A challenge row used to carry three parallel status languages on one card:
 * the lifecycle (`Awaiting response` / `Needs your response` / `Active` /
 * `Completed` / `Declined` / `Expired` / `Cancelled`), the live standing
 * (`LIVE` / `WINNING` / `LOSING` / `TIED`), and the lock state (`LOCKED` /
 * `IN PROGRESS`). Three vocabularies describing one thing is why the list read
 * as noise, so they are collapsed here into a single line that says where the
 * challenge stands and, when it is the viewer's move, what to do about it.
 *
 * Viewer-relative on purpose: "Your move" and "Sent" are the same row seen from
 * the two ends, and a shared label would have to be true for neither.
 */
export type ChallengeTone = 'act' | 'live' | 'win' | 'loss' | 'neutral' | 'muted'

export const TONE_COLOR: Record<ChallengeTone, string> = {
  act:     '#c17c00',
  live:    'var(--court)',
  win:     'var(--court)',
  loss:    '#c84b31',
  neutral: 'var(--ink)',
  muted:   'var(--muted)',
}

export interface ChallengeState {
  label: string
  tone: ChallengeTone
  /** The action this row is waiting on from the viewer, if any. */
  cta: string | null
}

export function challengeState(input: {
  status: string
  isChallenger: boolean
  /** Completed only. */
  isWinner?: boolean
  isDraw?: boolean
  /** Accepted only — the viewer's and opponent's points so far. */
  myPoints?: number
  theirPoints?: number
  /** Accepted only — whether the viewer still has picks to make in scope. */
  myPicksOutstanding?: boolean
}): ChallengeState {
  const { status, isChallenger } = input

  if (status === 'draft') {
    return { label: 'Draft', tone: 'act', cta: 'Finish and send' }
  }

  if (status === 'pending') {
    return isChallenger
      ? { label: 'Invite sent', tone: 'muted', cta: null }
      : { label: 'Your move', tone: 'act', cta: 'Accept or decline' }
  }

  if (status === 'accepted') {
    if (input.myPicksOutstanding) {
      return { label: 'Your move', tone: 'act', cta: 'Make your picks' }
    }
    const mine = input.myPoints ?? 0
    const theirs = input.theirPoints ?? 0
    if (mine === 0 && theirs === 0) return { label: 'Live', tone: 'live', cta: null }
    if (mine > theirs) return { label: 'Ahead', tone: 'win', cta: null }
    if (theirs > mine) return { label: 'Behind', tone: 'loss', cta: null }
    return { label: 'Level', tone: 'neutral', cta: null }
  }

  if (status === 'completed') {
    if (input.isDraw) return { label: 'Draw', tone: 'neutral', cta: null }
    return input.isWinner
      ? { label: 'Won', tone: 'win', cta: null }
      : { label: 'Lost', tone: 'loss', cta: null }
  }

  if (status === 'declined')  return { label: 'Declined',  tone: 'muted', cta: null }
  if (status === 'expired')   return { label: 'Expired',   tone: 'muted', cta: null }
  if (status === 'cancelled') return { label: 'Cancelled', tone: 'muted', cta: null }

  return { label: status, tone: 'muted', cta: null }
}
