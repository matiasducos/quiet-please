/**
 * The two layouts a bracket can be read in.
 *
 * `rounds` is the original one-round-at-a-time list and the default for
 * everyone. `full` is the whole draw as one tree, offered beside it as an
 * experiment — see migration 108.
 */
export type BracketView = 'rounds' | 'full'

/** Anything that is not exactly 'full' reads as the default. */
export function parseBracketView(value: unknown): BracketView {
  return value === 'full' ? 'full' : 'rounds'
}
