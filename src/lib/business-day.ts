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

/** Strip leading colon from POSIX-style TZ values for Intl compatibility */
export function sanitizeTimezone(tz: string | undefined): string | undefined {
  if (!tz) return tz
  return tz.startsWith(':') ? tz.slice(1) : tz
}

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
 * return the business day's start and end timestamps as UTC Date objects.
 *
 * Business day "2026-02-10" with dayStartTime "04:00" means:
 *   start: 2026-02-10T04:00:00.000 (in venue timezone)
 *   end:   2026-02-11T03:59:59.999 (in venue timezone)
 *
 * When `timezone` is provided (e.g. 'America/New_York'), the boundaries are
 * computed in that timezone and converted to UTC — correct for Vercel (UTC)
 * querying the DB for US venues. When omitted, the existing server-local-time
 * behavior is preserved (works on NUC where TZ matches the venue).
 */
export function getBusinessDayRange(
  dateStr: string,
  dayStartTime: string,
  timezone?: string
): { start: Date; end: Date } {
  const { hours, minutes } = parseTimeString(dayStartTime)

  if (timezone) {
    // Build the start Date in the target timezone, then convert to UTC.
    // We use Intl.DateTimeFormat to discover the UTC offset for the target
    // local time, then construct the correct UTC instant.
    const start = localToUTC(dateStr, hours, minutes, 0, 0, timezone)

    // End: next day at dayStartTime - 1ms
    // Advance by exactly 24h - 1ms (handles DST because we re-derive from
    // the next calendar day in the target timezone)
    const nextDay = new Date(new Date(dateStr + 'T12:00:00Z').getTime() + 86400000)
    const nextDateStr = nextDay.toISOString().split('T')[0]
    const end = localToUTC(nextDateStr, hours, minutes, 0, -1, timezone)

    return { start, end }
  }

  // Fallback: server-local-time (NUC where process TZ matches the venue)
  const start = new Date(dateStr + 'T00:00:00')
  start.setHours(hours, minutes, 0, 0)

  // End: next day at dayStartTime - 1ms
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  end.setMilliseconds(end.getMilliseconds() - 1)

  return { start, end }
}

/**
 * Convert a local date/time in a given IANA timezone to a UTC Date.
 * Uses Intl.DateTimeFormat to resolve the correct UTC offset (DST-aware).
 *
 * @param dateStr  "YYYY-MM-DD"
 * @param h        hours (0-23)
 * @param m        minutes
 * @param s        seconds
 * @param msAdjust milliseconds to add after construction (e.g. -1 for end-of-day)
 * @param tz       IANA timezone string, e.g. "America/Denver"
 */
function localToUTC(
  dateStr: string,
  h: number,
  m: number,
  s: number,
  msAdjust: number,
  tz: string
): Date {
  // Sanitize POSIX-style TZ (":UTC" → "UTC") — Vercel/some systems set TZ=:UTC
  if (tz.startsWith(':')) tz = tz.slice(1)
  // Step 1: Make a rough UTC guess (treat the local time as UTC)
  const [year, month, day] = dateStr.split('-').map(Number)
  const guessUTC = new Date(Date.UTC(year, month - 1, day, h, m, s, 0))

  // Step 2: Find the actual offset by formatting guessUTC in the target timezone
  // and comparing. We use 'en-US' with explicit parts to parse reliably.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = fmt.formatToParts(guessUTC)
  const p = (type: string) => parseInt(parts.find(x => x.type === type)?.value || '0', 10)
  const localAtGuess = new Date(Date.UTC(p('year'), p('month') - 1, p('day'), p('hour') === 24 ? 0 : p('hour'), p('minute'), p('second')))

  // offsetMs = how far the target local time is ahead of UTC
  // If localAtGuess shows 19:00 and guessUTC is 00:00 next day, offset = -5h
  const offsetMs = localAtGuess.getTime() - guessUTC.getTime()

  // Step 3: The correct UTC instant = desired local time minus offset
  const correctUTC = new Date(guessUTC.getTime() - offsetMs)

  // Verify by round-tripping (handles DST edge cases where offset changes)
  const verifyParts = fmt.formatToParts(correctUTC)
  const vp = (type: string) => parseInt(verifyParts.find(x => x.type === type)?.value || '0', 10)
  const verifyH = vp('hour') === 24 ? 0 : vp('hour')
  if (verifyH !== h || vp('minute') !== m) {
    // DST transition edge — re-derive with the verified offset
    const verifyLocal = new Date(Date.UTC(vp('year'), vp('month') - 1, vp('day'), verifyH, vp('minute'), vp('second')))
    const offset2 = verifyLocal.getTime() - correctUTC.getTime()
    const corrected = new Date(guessUTC.getTime() - offset2)
    if (msAdjust) corrected.setMilliseconds(corrected.getMilliseconds() + msAdjust)
    return corrected
  }

  if (msAdjust) correctUTC.setMilliseconds(correctUTC.getMilliseconds() + msAdjust)
  return correctUTC
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
  // Strip leading colon from POSIX-style TZ values (e.g. ":UTC" → "UTC")
  const rawTz = timezone || process.env.TIMEZONE || process.env.TZ
  const tz = rawTz?.startsWith(':') ? rawTz.slice(1) : rawTz
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
  const range = getBusinessDayRange(dateStr, dayStartTime, tz)

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
  // Strip leading colon from POSIX-style TZ values (e.g. ":UTC" → "UTC")
  const rawTz = process.env.TIMEZONE || process.env.TZ
  const tz = rawTz?.startsWith(':') ? rawTz.slice(1) : rawTz
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
  dayStartTime: string,
  timezone?: string
): boolean {
  const { start, end } = getBusinessDayRange(businessDateStr, dayStartTime, timezone)
  return timestamp >= start && timestamp <= end
}
