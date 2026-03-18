import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('business-day')

/**
 * Business Day Boundary Helpers (Skill 268)
 *
 * A "business day" for a bar/restaurant doesn't end at midnight.
 * If dayStartTime is "04:00", then:
 *   - Business day "2026-02-10" runs from Feb 10 4:00 AM to Feb 11 3:59:59.999 AM
 *   - An order at 1:30 AM on Feb 11 belongs to business day Feb 10
 *   - An order at 4:30 AM on Feb 11 belongs to business day Feb 11
 */

if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC') {
  log.warn('[BUSINESS-DAY] WARNING: System timezone is UTC. Business day calculations may be incorrect. Set TZ environment variable to the location timezone.')
}

/**
 * Parse a time string "HH:MM" into hours and minutes.
 */
export function parseTimeString(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number)
  return { hours: h || 0, minutes: m || 0 }
}

/**
 * Given a calendar date string (YYYY-MM-DD) and a dayStartTime ("HH:MM"),
 * return the business day's start and end timestamps.
 *
 * Business day "2026-02-10" with dayStartTime "04:00" means:
 *   start: 2026-02-10T04:00:00.000 (local)
 *   end:   2026-02-11T03:59:59.999 (local)
 */
export function getBusinessDayRange(
  dateStr: string,
  dayStartTime: string
): { start: Date; end: Date } {
  const { hours, minutes } = parseTimeString(dayStartTime)

  // Start: the given date at dayStartTime
  const start = new Date(dateStr + 'T00:00:00')
  start.setHours(hours, minutes, 0, 0)

  // End: next day at dayStartTime - 1ms
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  end.setMilliseconds(end.getMilliseconds() - 1)

  return { start, end }
}

/**
 * Given the current time and dayStartTime, determine which business day "today" is.
 * Returns the business date string (YYYY-MM-DD) and the range.
 *
 * If it's 2:00 AM and dayStartTime is "04:00", the business day is "yesterday".
 */
export function getCurrentBusinessDay(dayStartTime: string, timezone?: string): {
  date: string
  start: Date
  end: Date
} {
  const now = new Date()
  const { hours, minutes } = parseTimeString(dayStartTime)

  // Use timezone-aware local time if a timezone is provided (or via TZ env var)
  const tz = timezone || process.env.TIMEZONE || process.env.TZ
  let currentHours: number
  let currentMins: number
  let localDateStr: string

  if (tz) {
    const localStr = now.toLocaleString('en-US', { timeZone: tz })
    const localDate = new Date(localStr)
    currentHours = localDate.getHours()
    currentMins = localDate.getMinutes()
    // Format as YYYY-MM-DD from the timezone-aware date
    const y = localDate.getFullYear()
    const m = String(localDate.getMonth() + 1).padStart(2, '0')
    const d = String(localDate.getDate()).padStart(2, '0')
    localDateStr = `${y}-${m}-${d}`
  } else {
    currentHours = now.getHours()
    currentMins = now.getMinutes()
    localDateStr = now.toISOString().split('T')[0]
  }

  // Determine the business date:
  // If current time is BEFORE dayStartTime, it belongs to the previous calendar date's business day
  const currentMinutes = currentHours * 60 + currentMins
  const startMinutes = hours * 60 + minutes

  const businessDate = new Date(localDateStr + 'T12:00:00')
  if (currentMinutes < startMinutes) {
    // Before start time -> belongs to previous day's business day
    businessDate.setDate(businessDate.getDate() - 1)
  }

  const dateStr = `${businessDate.getFullYear()}-${String(businessDate.getMonth() + 1).padStart(2, '0')}-${String(businessDate.getDate()).padStart(2, '0')}`
  const range = getBusinessDayRange(dateStr, dayStartTime)

  return { date: dateStr, ...range }
}

/**
 * Determine which business date a given timestamp belongs to.
 * Returns the business date string (YYYY-MM-DD).
 */
export function getBusinessDateForTimestamp(
  timestamp: Date,
  dayStartTime: string
): string {
  const { hours, minutes } = parseTimeString(dayStartTime)
  const startMinutes = hours * 60 + minutes

  // Use timezone-aware date extraction
  const tz = process.env.TIMEZONE || process.env.TZ
  let tsHours: number
  let tsMinutes: number
  let localDateStr: string

  if (tz) {
    const localStr = timestamp.toLocaleString('en-US', { timeZone: tz })
    const localDate = new Date(localStr)
    tsHours = localDate.getHours()
    tsMinutes = localDate.getMinutes()
    const y = localDate.getFullYear()
    const m = String(localDate.getMonth() + 1).padStart(2, '0')
    const d = String(localDate.getDate()).padStart(2, '0')
    localDateStr = `${y}-${m}-${d}`
  } else {
    tsHours = timestamp.getHours()
    tsMinutes = timestamp.getMinutes()
    // Fallback: extract local date components
    const year = timestamp.getFullYear()
    const month = String(timestamp.getMonth() + 1).padStart(2, '0')
    const day = String(timestamp.getDate()).padStart(2, '0')
    localDateStr = `${year}-${month}-${day}`
  }

  const tsMinutesTotal = tsHours * 60 + tsMinutes
  const businessDate = new Date(localDateStr + 'T12:00:00')
  if (tsMinutesTotal < startMinutes) {
    businessDate.setDate(businessDate.getDate() - 1)
  }

  const year = businessDate.getFullYear()
  const month = String(businessDate.getMonth() + 1).padStart(2, '0')
  const day = String(businessDate.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Check if a timestamp falls within a specific business day.
 */
export function isWithinBusinessDay(
  timestamp: Date,
  businessDateStr: string,
  dayStartTime: string
): boolean {
  const { start, end } = getBusinessDayRange(businessDateStr, dayStartTime)
  return timestamp >= start && timestamp <= end
}
