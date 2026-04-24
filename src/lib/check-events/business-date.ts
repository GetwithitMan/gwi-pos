/**
 * Business Date for Check Aggregate
 *
 * Determines the current business date for a location.
 * Business date authority comes from the NUC server, NOT device clocks.
 *
 * Default EOD cutoff: 4:00 AM local time (configurable via location settings).
 * Before cutoff → previous calendar date is the business date.
 * After cutoff → current calendar date is the business date.
 *
 * Delegates to the shared getCurrentBusinessDay() utility which handles
 * timezone conversion via Intl.DateTimeFormat — no external date library needed.
 */

import { getCurrentBusinessDay } from '@/lib/business-day'

/**
 * Get the current business date for a location.
 *
 * @param locationTimezone  IANA timezone (e.g. "America/New_York")
 * @param eodCutoffHour    Hour (0-23) when the business day starts. Default: 4 (4:00 AM)
 * @returns Business date as "YYYY-MM-DD" string
 */
export function getBusinessDate(
  locationTimezone: string,
  eodCutoffHour: number = 4
): string {
  const dayStartTime = `${String(eodCutoffHour).padStart(2, '0')}:00`
  const { date } = getCurrentBusinessDay(dayStartTime, locationTimezone)
  return date
}
