import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { checkReportRateLimit } from '@/lib/report-rate-limiter'
import { getBusinessDayRange } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'

// ============================================================
// ENTERTAINMENT REVENUE REPORT
// ============================================================
// Provides detailed analytics for timed rental items:
// pool tables, bowling lanes, dart boards, etc.
//
// Breaks down revenue, sessions, utilization, and hourly
// distribution for entertainment-category items.
// ============================================================

function round(value: number): number {
  return Math.round(value * 100) / 100
}

// GET - Entertainment revenue report
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const rateCheck = checkReportRateLimit(requestingEmployeeId || 'anonymous')
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Rate limited', retryAfter: rateCheck.retryAfterSeconds }, { status: 429 })
    }

    // Build date range using business day boundaries
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay?.dayStartTime || '04:00'

    let startOfRange: Date
    let endOfRange: Date

    if (startDate && endDate) {
      startOfRange = getBusinessDayRange(startDate, dayStartTime).start
      endOfRange = getBusinessDayRange(endDate, dayStartTime).end
    } else if (startDate) {
      startOfRange = getBusinessDayRange(startDate, dayStartTime).start
      endOfRange = new Date() // up to now
    } else {
      // Default to today
      const today = new Date().toISOString().split('T')[0]
      const range = getBusinessDayRange(today, dayStartTime)
      startOfRange = range.start
      endOfRange = range.end
    }

    // ── Run all queries in parallel ──────────────────────────────

    const [entertainmentItems, waitlistEntries] = await Promise.all([
      // 1) All entertainment order items with block time tracking
      db.orderItem.findMany({
        where: {
          locationId,
          deletedAt: null,
          blockTimeStartedAt: { not: null },
          menuItem: {
            itemType: 'timed_rental',
          },
          order: {
            locationId,
            deletedAt: null,
            isTraining: { not: true },
            status: { in: [...REVENUE_ORDER_STATUSES] },
            OR: [
              { businessDayDate: { gte: startOfRange, lte: endOfRange } },
              { businessDayDate: null, createdAt: { gte: startOfRange, lte: endOfRange } },
            ],
          },
        },
        include: {
          menuItem: {
            select: {
              id: true,
              name: true,
              overtimeEnabled: true,
              overtimeMode: true,
              overtimeMultiplier: true,
              overtimePerMinuteRate: true,
              overtimeFlatFee: true,
              overtimeGraceMinutes: true,
            },
          },
          order: {
            select: {
              id: true,
              createdAt: true,
              businessDayDate: true,
            },
          },
        },
      }),

      // 2) Waitlist entries for the date range
      db.entertainmentWaitlist.findMany({
        where: {
          locationId,
          deletedAt: null,
          requestedAt: { gte: startOfRange, lte: endOfRange },
        },
        select: {
          id: true,
          status: true,
          requestedAt: true,
          seatedAt: true,
        },
      }),
    ])

    // ── Process entertainment items ──────────────────────────────

    let totalRevenue = 0
    let totalSessions = 0
    let totalMinutes = 0
    let overtimeRevenue = 0
    let comps = 0
    let compValue = 0

    // By item breakdown
    const byItemMap: Record<string, {
      menuItemId: string
      name: string
      sessions: number
      totalMinutes: number
      revenue: number
      overtimeRevenue: number
    }> = {}

    // By hour breakdown
    const byHourMap: Record<number, {
      hour: number
      sessions: number
      revenue: number
    }> = {}

    entertainmentItems.forEach(item => {
      const itemTotal = Number(item.itemTotal) || 0
      const blockMinutes = item.blockTimeMinutes || 0
      const startedAt = item.blockTimeStartedAt!

      // Calculate actual session duration
      const expiresAt = item.blockTimeExpiresAt
      let sessionMinutes = blockMinutes
      if (expiresAt && startedAt) {
        sessionMinutes = Math.round((expiresAt.getTime() - startedAt.getTime()) / (1000 * 60))
      }

      // Detect comps
      if (item.status === 'comped') {
        comps += item.quantity
        compValue += Number(item.price) * item.quantity
        return // Don't count comps in revenue
      }

      totalRevenue += itemTotal
      totalSessions += item.quantity
      totalMinutes += sessionMinutes * item.quantity

      // Calculate overtime revenue estimate
      // If session went beyond block time, estimate overtime portion
      if (item.menuItem.overtimeEnabled && blockMinutes > 0 && sessionMinutes > blockMinutes) {
        const overtimeMinutes = sessionMinutes - blockMinutes
        const graceMinutes = item.menuItem.overtimeGraceMinutes ?? 5
        if (overtimeMinutes > graceMinutes) {
          // Estimate overtime portion based on mode
          const baseRate = blockMinutes > 0 ? (Number(item.price) / blockMinutes) : 0
          let estimatedOT = 0
          switch (item.menuItem.overtimeMode) {
            case 'multiplier':
              estimatedOT = baseRate * (overtimeMinutes - graceMinutes) * Number(item.menuItem.overtimeMultiplier || 1.5)
              break
            case 'per_minute':
              estimatedOT = (overtimeMinutes - graceMinutes) * Number(item.menuItem.overtimePerMinuteRate || 0)
              break
            case 'flat_fee':
              estimatedOT = Number(item.menuItem.overtimeFlatFee || 0)
              break
            default:
              estimatedOT = baseRate * (overtimeMinutes - graceMinutes) * 1.5
          }
          overtimeRevenue += estimatedOT * item.quantity
        }
      }

      // By item aggregation
      const menuItemId = item.menuItemId
      if (!byItemMap[menuItemId]) {
        byItemMap[menuItemId] = {
          menuItemId,
          name: item.menuItem.name,
          sessions: 0,
          totalMinutes: 0,
          revenue: 0,
          overtimeRevenue: 0,
        }
      }
      byItemMap[menuItemId].sessions += item.quantity
      byItemMap[menuItemId].totalMinutes += sessionMinutes * item.quantity
      byItemMap[menuItemId].revenue += itemTotal

      // By hour aggregation (use the hour when session started)
      const tz = process.env.TIMEZONE || process.env.TZ
      const hour = tz
        ? new Date(startedAt).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
        : String(startedAt.getHours())
      const hourNum = parseInt(hour, 10)

      if (!byHourMap[hourNum]) {
        byHourMap[hourNum] = { hour: hourNum, sessions: 0, revenue: 0 }
      }
      byHourMap[hourNum].sessions += item.quantity
      byHourMap[hourNum].revenue += itemTotal
    })

    // Calculate utilization per item
    // Utilization = actual minutes used / total possible minutes in date range
    const totalHoursInRange = (endOfRange.getTime() - startOfRange.getTime()) / (1000 * 60 * 60)

    const byItem = Object.values(byItemMap)
      .map(item => ({
        ...item,
        revenue: round(item.revenue),
        overtimeRevenue: round(item.overtimeRevenue),
        utilizationPercent: totalHoursInRange > 0
          ? round((item.totalMinutes / (totalHoursInRange * 60)) * 100)
          : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)

    const byHour = Object.values(byHourMap)
      .map(h => ({
        ...h,
        revenue: round(h.revenue),
      }))
      .sort((a, b) => a.hour - b.hour)

    // ── Process waitlist ──────────────────────────────────────────

    let waitlistServed = 0
    let waitlistCancelled = 0
    let waitlistExpired = 0
    let totalWaitMinutes = 0
    let waitCountForAvg = 0

    waitlistEntries.forEach(entry => {
      switch (entry.status) {
        case 'seated':
          waitlistServed++
          if (entry.seatedAt && entry.requestedAt) {
            totalWaitMinutes += (entry.seatedAt.getTime() - entry.requestedAt.getTime()) / (1000 * 60)
            waitCountForAvg++
          }
          break
        case 'cancelled':
          waitlistCancelled++
          break
        case 'expired':
          waitlistExpired++
          break
        // 'waiting' and 'notified' are still pending
      }
    })

    // ── Build response ────────────────────────────────────────────

    return NextResponse.json({
      data: {
        summary: {
          totalRevenue: round(totalRevenue),
          totalSessions,
          totalMinutes,
          averageSessionMinutes: totalSessions > 0 ? round(totalMinutes / totalSessions) : 0,
          averageRevenuePerSession: totalSessions > 0 ? round(totalRevenue / totalSessions) : 0,
          overtimeRevenue: round(overtimeRevenue),
          comps,
          compValue: round(compValue),
        },
        byItem,
        byHour,
        waitlist: {
          totalEntries: waitlistEntries.length,
          served: waitlistServed,
          cancelled: waitlistCancelled,
          expired: waitlistExpired,
          averageWaitMinutes: waitCountForAvg > 0 ? round(totalWaitMinutes / waitCountForAvg) : 0,
        },
        filters: {
          locationId,
          startDate: startDate || null,
          endDate: endDate || null,
          dateRangeStart: startOfRange.toISOString(),
          dateRangeEnd: endOfRange.toISOString(),
        },
      },
    })
  } catch (error) {
    console.error('Failed to generate entertainment report:', error)
    return NextResponse.json(
      { error: 'Failed to generate entertainment report' },
      { status: 500 }
    )
  }
})
