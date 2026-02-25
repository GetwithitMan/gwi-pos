/**
 * Timezone-aware date boundary helpers.
 *
 * All "today" and date-range calculations in API routes must use the venue's
 * `location.timezone` (IANA, e.g. "America/New_York") so that midnight aligns
 * with the venue's local wall clock, not the server's UTC.
 *
 * Uses the built-in Intl API — no external dependencies required.
 */

// ---------------------------------------------------------------------------
// Core: convert a local datetime in a named timezone to a UTC Date
// ---------------------------------------------------------------------------

/**
 * Build a UTC `Date` that corresponds to the given wall-clock time in `timezone`.
 *
 * Example: `tzToUTC(2026, 2, 25, 0, 0, 0, 0, 'America/New_York')`
 * returns the UTC instant for midnight Feb 25 2026 in New York (05:00 UTC).
 */
export function tzToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timezone: string,
): Date {
  // Treat the local components as if they were UTC
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms))

  // Determine the offset between UTC and the target timezone at that instant
  const utcStr = utcGuess.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = utcGuess.toLocaleString('en-US', { timeZone: timezone })
  const offset = new Date(utcStr).getTime() - new Date(tzStr).getTime()

  return new Date(utcGuess.getTime() + offset)
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Get "today" in the venue's timezone as a YYYY-MM-DD string.
 */
export function getTodayInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const y = parts.find(p => p.type === 'year')!.value
  const m = parts.find(p => p.type === 'month')!.value
  const d = parts.find(p => p.type === 'day')!.value
  return `${y}-${m}-${d}`
}

/**
 * Return the UTC start and end of a calendar date in the venue's timezone.
 *
 * `getLocationDateRange('America/New_York')`
 * → { startOfDay: <midnight EST in UTC>, endOfDay: <23:59:59.999 EST in UTC> }
 *
 * If `dateStr` is omitted, uses "today" in the given timezone.
 */
export function getLocationDateRange(
  timezone: string,
  dateStr?: string,
): { startOfDay: Date; endOfDay: Date } {
  const date = dateStr ?? getTodayInTimezone(timezone)
  const [y, m, d] = date.split('-').map(Number)

  const startOfDay = tzToUTC(y, m, d, 0, 0, 0, 0, timezone)
  const endOfDay = tzToUTC(y, m, d, 23, 59, 59, 999, timezone)

  return { startOfDay, endOfDay }
}

/**
 * Convert a date-range pair of YYYY-MM-DD strings to UTC timestamps
 * in the venue's timezone.  Handy for API routes that receive
 * `startDate` / `endDate` query params.
 *
 * If `endDateStr` is omitted the range covers only the start date.
 */
export function dateRangeToUTC(
  startDateStr: string,
  endDateStr: string | undefined | null,
  timezone: string,
): { start: Date; end: Date } {
  const [sy, sm, sd] = startDateStr.split('-').map(Number)
  const start = tzToUTC(sy, sm, sd, 0, 0, 0, 0, timezone)

  if (endDateStr) {
    const [ey, em, ed] = endDateStr.split('-').map(Number)
    const end = tzToUTC(ey, em, ed, 23, 59, 59, 999, timezone)
    return { start, end }
  }

  // Single-day range
  const end = tzToUTC(sy, sm, sd, 23, 59, 59, 999, timezone)
  return { start, end }
}

/**
 * Get the hour-of-day for a UTC timestamp in the venue's timezone.
 * Used for daypart bucketing.
 */
export function getHourInTimezone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date)
  return Number(parts.find(p => p.type === 'hour')!.value) % 24
}
