/**
 * ISO 8601 week utilities.
 *
 * ISO weeks run Monday → Sunday.
 * Week 1 is the week that contains the year's first Thursday.
 * A year can have 52 or 53 ISO weeks.
 */

export interface ISOWeek {
  year: number
  week: number
}

/**
 * Returns the ISO 8601 { year, week } for a given Date.
 * Works in UTC to avoid timezone edge-cases.
 */
export function getISOWeek(date: Date): ISOWeek {
  // Clone and truncate to UTC midnight
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

  // ISO day-of-week: Mon=1 … Sun=7  (JS getUTCDay gives 0=Sun, so || 7 converts Sunday)
  const isoDow = d.getUTCDay() || 7

  // Shift to the Thursday of this ISO week — the anchor day for week numbering
  d.setUTCDate(d.getUTCDate() + 4 - isoDow)

  // Week number = ceil( (dayOfYear + 1) / 7 )  where dayOfYear is 0-based from Jan 1
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)

  return { year: d.getUTCFullYear(), week: weekNum }
}

/**
 * Returns all distinct ISO weeks spanned by a tournament.
 *
 * - Most tournaments (1 week): returns one entry.
 * - Grand Slams (2 weeks, e.g. Mon Jan 13 – Sun Jan 26): returns two entries.
 *
 * Advances in 7-day steps from the start date until it passes the end date,
 * collecting unique ISO weeks along the way.
 */
export function getTournamentISOWeeks(startsAt: string, endsAt: string): ISOWeek[] {
  const start = new Date(startsAt)
  const end   = new Date(endsAt)

  const weeks: ISOWeek[] = []
  const seen  = new Set<string>()

  // Cursor starts at UTC midnight of the start date
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  const endUTC = new Date(Date.UTC(end.getUTCFullYear(),   end.getUTCMonth(),   end.getUTCDate()))

  while (cursor <= endUTC) {
    const w   = getISOWeek(cursor)
    const key = `${w.year}-${w.week}`
    if (!seen.has(key)) {
      seen.add(key)
      weeks.push(w)
    }
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  }

  return weeks
}
