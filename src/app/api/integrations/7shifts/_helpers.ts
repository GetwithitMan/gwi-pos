import { db } from '@/lib/db'
import { parseSettings, type SevenShiftsSettings } from '@/lib/settings'

/**
 * Compute a YYYY-MM-DD business date in a timezone, with optional days offset.
 * Default: yesterday (daysOffset = -1).
 */
export function getBusinessDate(timezone: string, daysOffset = -1): string {
  const target = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(target)
  const year = parts.find(p => p.type === 'year')!.value
  const month = parts.find(p => p.type === 'month')!.value
  const day = parts.find(p => p.type === 'day')!.value
  return `${year}-${month}-${day}`
}

/**
 * Convert a YYYY-MM-DD business date + timezone into a UTC start/end range.
 */
export function getDateRange(businessDate: string, timezone: string): { start: Date; end: Date } {
  // Create date at midnight in the target timezone by computing offset
  const [year, month, day] = businessDate.split('-').map(Number)

  // Use a reference point in the target timezone to compute UTC offset
  const refDate = new Date(`${businessDate}T12:00:00Z`)
  const utcStr = refDate.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = refDate.toLocaleString('en-US', { timeZone: timezone })
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime()

  // Midnight in timezone = midnight UTC + offset
  const start = new Date(Date.UTC(year, month - 1, day) + offsetMs)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

/**
 * Update 7shifts sync status fields in location settings.
 */
export async function updateSyncStatus(
  locationId: string,
  updates: Partial<SevenShiftsSettings>
): Promise<void> {
  try {
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    if (!location) return
    const parsed = parseSettings(location.settings)
    await db.location.update({
      where: { id: locationId },
      data: {
        settings: {
          ...parsed,
          sevenShifts: { ...parsed.sevenShifts, ...updates },
        } as object,
      },
    })
  } catch {
    // Non-fatal — sync status update should not throw
  }
}
