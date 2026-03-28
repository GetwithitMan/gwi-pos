import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// GET /api/kds/all-day-counts?locationId=X&resetHour=4
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const resetHour = parseInt(searchParams.get('resetHour') || '4', 10)

    if (!locationId) {
      return err('Location ID is required')
    }

    // Clamp resetHour to valid range
    const safeResetHour = Number.isNaN(resetHour) || resetHour < 0 || resetHour > 23 ? 4 : resetHour

    // Resolve location timezone
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = location?.timezone || 'America/New_York'

    // Calculate "since" time in location's timezone:
    // If current hour >= resetHour, use today at resetHour:00
    // If current hour < resetHour, use yesterday at resetHour:00
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = formatter.formatToParts(now)
    const localYear = parseInt(parts.find(p => p.type === 'year')!.value, 10)
    const localMonth = parseInt(parts.find(p => p.type === 'month')!.value, 10) - 1 // 0-indexed
    const localDay = parseInt(parts.find(p => p.type === 'day')!.value, 10)
    const localHour = parseInt(parts.find(p => p.type === 'hour')!.value, 10)

    // Build the reset boundary in local time, then convert to UTC
    // If current hour >= resetHour, "since" is today at resetHour
    // If current hour < resetHour, "since" is yesterday at resetHour
    let sinceLocal: Date
    if (localHour >= safeResetHour) {
      // Today at reset hour
      sinceLocal = new Date(`${localYear}-${String(localMonth + 1).padStart(2, '0')}-${String(localDay).padStart(2, '0')}T${String(safeResetHour).padStart(2, '0')}:00:00`)
    } else {
      // Yesterday at reset hour
      const yesterday = new Date(localYear, localMonth, localDay - 1)
      sinceLocal = new Date(
        `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}T${String(safeResetHour).padStart(2, '0')}:00:00`
      )
    }

    // Convert local time to UTC by computing the offset
    // Create a date string in the target timezone and find the offset
    const utcFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    // Use a known reference point to calculate offset
    const refParts = utcFormatter.formatToParts(sinceLocal)
    const refYear = parseInt(refParts.find(p => p.type === 'year')!.value, 10)
    const refMonth = parseInt(refParts.find(p => p.type === 'month')!.value, 10) - 1
    const refDay = parseInt(refParts.find(p => p.type === 'day')!.value, 10)
    const refHour = parseInt(refParts.find(p => p.type === 'hour')!.value, 10)
    const refMinute = parseInt(refParts.find(p => p.type === 'minute')!.value, 10)
    const refSecond = parseInt(refParts.find(p => p.type === 'second')!.value, 10)
    const localAsUtc = new Date(Date.UTC(refYear, refMonth, refDay, refHour, refMinute, refSecond))
    const offsetMs = localAsUtc.getTime() - sinceLocal.getTime()

    // since in UTC = sinceLocal adjusted by timezone offset
    const sinceUtc = new Date(sinceLocal.getTime() + offsetMs)

    // K14: Query OrderItem counts grouped by item name.
    // Exclude resent items (resendCount > 0) to avoid inflated counts —
    // only count the original send of each item.
    const results = await db.orderItem.groupBy({
      by: ['name'],
      where: {
        locationId,
        kitchenSentAt: { gte: sinceUtc },
        deletedAt: null,
        status: { not: 'voided' },
        resendCount: { equals: 0 },
      },
      _sum: {
        quantity: true,
      },
    })

    // Format and sort by count descending
    const counts = results
      .map(row => ({
        name: row.name,
        count: row._sum.quantity || 0,
      }))
      .sort((a, b) => b.count - a.count)

    return ok({
        counts,
        since: sinceUtc.toISOString(),
        resetHour: safeResetHour,
      })
  } catch (error) {
    console.error('Failed to fetch all-day counts:', error)
    return err('Failed to fetch all-day counts', 500)
  }
})
