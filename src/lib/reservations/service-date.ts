/**
 * Service Date Utilities
 *
 * Handles service-date logic (late-night = previous calendar date),
 * time-to-minutes conversion, and operating-hours overlap checks.
 */

/**
 * Returns YYYY-MM-DD service date. If local time < serviceEndHour → previous calendar date.
 * Uses Intl.DateTimeFormat for timezone-safe conversion (no external deps).
 */
export function getServiceDate(dateTime: Date, timezone: string, serviceEndHour: number = 4): string {
  // Get the wall-clock components in the target timezone
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(dateTime)

  const year = parseInt(parts.find(p => p.type === 'year')!.value, 10)
  const month = parseInt(parts.find(p => p.type === 'month')!.value, 10)
  const day = parseInt(parts.find(p => p.type === 'day')!.value, 10)
  const hour = parseInt(parts.find(p => p.type === 'hour')!.value, 10)

  // If before serviceEndHour, this belongs to previous day's service
  if (hour < serviceEndHour) {
    const d = new Date(year, month - 1, day)
    d.setDate(d.getDate() - 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Parse "HH:MM" time string to minutes from midnight.
 * "14:30" → 870
 */
export function parseTimeToMinutes(time: string): number {
  if (!time || typeof time !== 'string') throw new Error(`Invalid time: ${time}`)
  const parts = time.split(':')
  if (parts.length !== 2) throw new Error(`Invalid time format: ${time}`)
  const [hours, minutes] = parts.map(Number)
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time value: ${time}`)
  }
  return hours * 60 + minutes
}

/**
 * Convert minutes from midnight to "HH:MM" string.
 * 870 → "14:30"
 */
export function minutesToTime(minutes: number): string {
  // Handle cross-midnight wrap
  const normalized = ((minutes % 1440) + 1440) % 1440
  const h = Math.floor(normalized / 60).toString().padStart(2, '0')
  const m = (normalized % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

/**
 * Check if a time (in minutes) falls within operating hours.
 * Handles cross-midnight: if close < open, valid = time >= open || time < close
 */
export function isWithinOperatingHours(
  timeMinutes: number,
  openMinutes: number,
  closeMinutes: number
): boolean {
  if (closeMinutes > openMinutes) {
    // Same-day: e.g. open=600 (10:00), close=1380 (23:00)
    return timeMinutes >= openMinutes && timeMinutes < closeMinutes
  }
  // Cross-midnight: e.g. open=1020 (17:00), close=180 (3:00)
  return timeMinutes >= openMinutes || timeMinutes < closeMinutes
}

/**
 * Calculate slot end time in minutes, handling cross-midnight wrap.
 */
export function getSlotEndMinutes(slotMinutes: number, durationMinutes: number): number {
  return (slotMinutes + durationMinutes) % 1440
}

/**
 * Check if two time windows overlap. Handles cross-midnight for both slots.
 * Each slot is defined by start (minutes) and duration (minutes).
 */
export function slotsOverlap(
  slot1Start: number,
  slot1Duration: number,
  slot2Start: number,
  slot2Duration: number
): boolean {
  // Expand both slots into a set of minutes and check intersection.
  // For slots < 1440 min (24h), this is safe.
  // Use range-based math instead of set expansion for efficiency.
  const s1End = slot1Start + slot1Duration
  const s2End = slot2Start + slot2Duration

  // Both slots fit within 24h (no wrap)
  if (s1End <= 1440 && s2End <= 1440) {
    return slot1Start < s2End && s1End > slot2Start
  }

  // At least one slot wraps past midnight — normalize to [0, 2880) range
  // by duplicating the day, then check overlap on the extended timeline.
  return rangeOverlaps(slot1Start, s1End, slot2Start, s2End)
    || rangeOverlaps(slot1Start, s1End, slot2Start + 1440, s2End + 1440)
    || rangeOverlaps(slot1Start + 1440, s1End + 1440, slot2Start, s2End)
}

function rangeOverlaps(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 < b2 && a2 > b1
}
