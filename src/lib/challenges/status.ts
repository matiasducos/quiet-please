/**
 * Which challenge statuses belong in "Past challenges".
 *
 * `expired` is deliberately absent: an expired challenge is one the opponent
 * never answered, so there is no bracket, no score and nothing to look back on.
 * Listing it only pads the history with non-events.
 *
 * Shared because `/challenges` filters this list in memory while
 * `/challenges/past` pushes it to the database — two copies would drift and the
 * "See all →" page would start showing rows the parent page hides.
 */
export const PAST_CHALLENGE_STATUSES = ['completed', 'declined', 'cancelled'] as const

/** Statuses that mean the challenge never actually happened. */
export const NON_EVENT_CHALLENGE_STATUSES = ['cancelled', 'expired'] as const
