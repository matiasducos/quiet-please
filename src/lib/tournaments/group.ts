/**
 * Grouping tournaments into calendar months.
 *
 * Shared because two surfaces render the same accordion: /tournaments groups a
 * whole season in calendar order, and a league groups its completed events
 * newest-first. Both need the same month label and the same answer for a
 * tournament with no start date — duplicating that is how "Date TBC" ends up
 * spelled two ways and sorted two ways.
 */

export interface MonthGroup<T> {
  /** Sort key, `YYYY-MM` — also the value to compare against currentMonthKey(). */
  key: string
  /** Human label, e.g. "March 2026". */
  label: string
  list: T[]
}

/** A tournament with no start date belongs to no month. Sorted last either way. */
const TBC_KEY = '9999-99'

export function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** The month the visitor is in, in the same `YYYY-MM` shape the group keys use. */
export function currentMonthKey(): string {
  return monthKeyOf(new Date())
}

/**
 * Group by calendar month.
 *
 * `order` is 'asc' for a calendar (the season as it unfolds) and 'desc' for an
 * archive (what happened, most recent first). Undated tournaments stay last in
 * both — under 'desc' a naive key sort would float them to the top, which puts
 * "Date TBC" above the tournament that finished last week.
 */
export function groupByMonth<T extends { starts_at?: string | null }>(
  list: T[],
  order: 'asc' | 'desc' = 'asc'
): MonthGroup<T>[] {
  const map = new Map<string, MonthGroup<T>>()

  for (const t of list) {
    let key = TBC_KEY
    let label = 'Date TBC'
    if (t.starts_at) {
      const d = new Date(t.starts_at)
      key = monthKeyOf(d)
      label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    }
    if (!map.has(key)) map.set(key, { key, label, list: [] })
    map.get(key)!.list.push(t)
  }

  return [...map.values()].sort((a, b) => {
    if (a.key === TBC_KEY) return 1
    if (b.key === TBC_KEY) return -1
    return order === 'asc' ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key)
  })
}
