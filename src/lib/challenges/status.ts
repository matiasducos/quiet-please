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
