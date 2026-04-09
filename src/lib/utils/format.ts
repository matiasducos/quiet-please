/** Format a number with comma separators for readability (e.g. 10240 → "10,240") */
export function formatPoints(n: number): string {
  return n.toLocaleString('en-US')
}
