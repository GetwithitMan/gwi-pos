/**
 * Cover Charge Report API
 *
 * GET /api/reports/cover-charges — cover charge report with date range
 *
 * Metrics: total entries, total revenue, comp count, VIP count,
 *          peak hour, average per entry, hourly volume breakdown.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getBusinessDayRange } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'
import { err, ok } from '@/lib/api-response'

interface CoverChargeRow {
  id: string
  amount: number | { toNumber?: () => number }
  paymentMethod: string
  guestCount: number
  isVip: boolean
  isComped: boolean
  createdAt: Date
  employeeId: string
}

function toNumber(val: unknown): number {
  if (typeof val === 'object' && val && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber()
  }
  return Number(val) || 0
}

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!locationId) {
      return err('Location ID is required')
    }
    if (!startDate) {
      return err('startDate is required')
    }

    // Permission check
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct date boundaries
    const timezone = await getLocationTimezone(locationId)

    const startRange = getBusinessDayRange(startDate, dayStartTime, timezone)
    const endRange = endDate
      ? getBusinessDayRange(endDate, dayStartTime, timezone)
      : startRange

    const rows = await db.$queryRawUnsafe<CoverChargeRow[]>(
      `SELECT "id", "amount", "paymentMethod", "guestCount", "isVip", "isComped", "createdAt", "employeeId"
       FROM "CoverCharge"
       WHERE "locationId" = $1 AND "deletedAt" IS NULL
         AND "createdAt" >= $2 AND "createdAt" <= $3
       ORDER BY "createdAt" ASC`,
      locationId,
      startRange.start,
      endRange.end
    )

    // Aggregate metrics
    let totalRevenue = 0
    const totalEntries = rows.length
    let totalGuests = 0
    let compCount = 0
    let vipCount = 0
    let cashTotal = 0
    let cardTotal = 0

    // Hourly buckets (0-23)
    const hourlyVolume: number[] = new Array(24).fill(0)
    const hourlyRevenue: number[] = new Array(24).fill(0)

    // Per-employee aggregation
    const employeeMap = new Map<string, { count: number; revenue: number }>()

    for (const row of rows) {
      const amt = toNumber(row.amount)
      totalRevenue += amt
      totalGuests += row.guestCount || 1

      if (row.isComped) compCount++
      if (row.isVip) vipCount++
      if (row.paymentMethod === 'cash') cashTotal += amt
      else cardTotal += amt

      const hour = row.createdAt instanceof Date
        ? row.createdAt.getHours()
        : new Date(row.createdAt).getHours()
      hourlyVolume[hour] += row.guestCount || 1
      hourlyRevenue[hour] += amt

      const empEntry = employeeMap.get(row.employeeId) || { count: 0, revenue: 0 }
      empEntry.count += row.guestCount || 1
      empEntry.revenue += amt
      employeeMap.set(row.employeeId, empEntry)
    }

    // Find peak hour
    let peakHour = 0
    let peakCount = 0
    for (let h = 0; h < 24; h++) {
      if (hourlyVolume[h] > peakCount) {
        peakCount = hourlyVolume[h]
        peakHour = h
      }
    }

    const avgPerEntry = totalEntries > 0 ? Math.round((totalRevenue / totalEntries) * 100) / 100 : 0

    // Build hourly breakdown (only hours with data)
    const hourlyBreakdown = []
    for (let h = 0; h < 24; h++) {
      if (hourlyVolume[h] > 0) {
        hourlyBreakdown.push({
          hour: h,
          label: `${h.toString().padStart(2, '0')}:00`,
          guests: hourlyVolume[h],
          revenue: Math.round(hourlyRevenue[h] * 100) / 100,
        })
      }
    }

    // Build employee breakdown
    const employeeBreakdown = Array.from(employeeMap.entries()).map(([empId, data]) => ({
      employeeId: empId,
      guestCount: data.count,
      revenue: Math.round(data.revenue * 100) / 100,
    }))

    return ok({
        totalEntries,
        totalGuests,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        cashTotal: Math.round(cashTotal * 100) / 100,
        cardTotal: Math.round(cardTotal * 100) / 100,
        compCount,
        vipCount,
        avgPerEntry,
        peakHour: {
          hour: peakHour,
          label: `${peakHour.toString().padStart(2, '0')}:00`,
          guestCount: peakCount,
        },
        hourlyBreakdown,
        employeeBreakdown,
        dateRange: {
          start: startRange.start.toISOString(),
          end: endRange.end.toISOString(),
        },
      })
  } catch (error) {
    console.error('[GET /api/reports/cover-charges] Error:', error)
    return err('Failed to generate cover charge report', 500)
  }
})
