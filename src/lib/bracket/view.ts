/**
 * The two layouts a bracket can be read in.
 *
 * `full` is the whole draw as one tree and the default since migration 110.
 * `rounds` is the original one-round-at-a-time list, kept one click away —
 * see migrations 108 and 110.
 */
export type BracketView = 'rounds' | 'full'

/** Anything that is not exactly 'rounds' reads as the default. */
export function parseBracketView(value: unknown): BracketView {
  return value === 'rounds' ? 'rounds' : 'full'
}
