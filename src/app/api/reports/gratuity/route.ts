import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getBusinessDayRange } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// GET - Generate gratuity / auto-gratuity report
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')

    if (!locationId || !startDateStr || !endDateStr) {
      return err('locationId, startDate, and endDate are required')
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_COMMISSION)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Resolve business day boundaries
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct date boundaries
    const timezone = await getLocationTimezone(locationId)
    const startRange = getBusinessDayRange(startDateStr, dayStartTime, timezone)
    const endRange = getBusinessDayRange(endDateStr, dayStartTime, timezone)

    // Query TipTransactions with kind = 'auto_gratuity' in the date range
    // Exclude training orders from gratuity report
    const autoGratTransactions = await db.tipTransaction.findMany({
      where: {
        locationId,
        kind: 'auto_gratuity',
        deletedAt: null,
        collectedAt: {
          gte: startRange.start,
          lte: endRange.end,
        },
        order: {
          isTraining: { not: true },
        },
      },
      include: {
        primaryEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
            subtotal: true,
            guestCount: true,
            createdAt: true,
          },
        },
      },
      orderBy: { collectedAt: 'desc' },
    })

    // Group by employee and date
    const employeeMap: Record<string, {
      employeeId: string
      employeeName: string
      dates: Record<string, {
        date: string
        orderCount: number
        totalGratuity: number
        totalOrderValue: number
        guestCounts: number[]
      }>
    }> = {}

    for (const txn of autoGratTransactions) {
      const empId = txn.primaryEmployeeId || 'unknown'
      const empName = txn.primaryEmployee
        ? (txn.primaryEmployee.displayName || `${txn.primaryEmployee.firstName} ${txn.primaryEmployee.lastName}`)
        : 'Unknown'

      if (!employeeMap[empId]) {
        employeeMap[empId] = {
          employeeId: empId,
          employeeName: empName,
          dates: {},
        }
      }

      const dateKey = txn.collectedAt.toISOString().split('T')[0]
      if (!employeeMap[empId].dates[dateKey]) {
        employeeMap[empId].dates[dateKey] = {
          date: dateKey,
          orderCount: 0,
          totalGratuity: 0,
          totalOrderValue: 0,
          guestCounts: [],
        }
      }

      const dateEntry = employeeMap[empId].dates[dateKey]
      dateEntry.orderCount++
      dateEntry.totalGratuity += Number(txn.amountCents) / 100 // Convert cents to dollars
      dateEntry.totalOrderValue += Number(txn.order?.subtotal ?? 0)
      if (txn.order?.guestCount) {
        dateEntry.guestCounts.push(txn.order.guestCount)
      }
    }

    // Build flat rows for the report
    const rows: Array<{
      employeeId: string
      employeeName: string
      date: string
      orderCount: number
      totalGratuity: number
      avgGratuityPercent: number
      totalOrderValue: number
      avgPartySize: number
    }> = []

    for (const emp of Object.values(employeeMap)) {
      for (const dateEntry of Object.values(emp.dates)) {
        const avgPct = dateEntry.totalOrderValue > 0
          ? round((dateEntry.totalGratuity / dateEntry.totalOrderValue) * 100)
          : 0
        const avgParty = dateEntry.guestCounts.length > 0
          ? round(dateEntry.guestCounts.reduce((a, b) => a + b, 0) / dateEntry.guestCounts.length)
          : 0

        rows.push({
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          date: dateEntry.date,
          orderCount: dateEntry.orderCount,
          totalGratuity: round(dateEntry.totalGratuity),
          avgGratuityPercent: avgPct,
          totalOrderValue: round(dateEntry.totalOrderValue),
          avgPartySize: avgParty,
        })
      }
    }

    // Sort by date desc, then employee name
    rows.sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName))

    // Summary totals
    const summary = {
      totalOrders: rows.reduce((s, r) => s + r.orderCount, 0),
      totalGratuity: round(rows.reduce((s, r) => s + r.totalGratuity, 0)),
      totalOrderValue: round(rows.reduce((s, r) => s + r.totalOrderValue, 0)),
      avgGratuityPercent: 0 as number,
    }
    summary.avgGratuityPercent = summary.totalOrderValue > 0
      ? round((summary.totalGratuity / summary.totalOrderValue) * 100)
      : 0

    // Auto-gratuity settings for display
    const autoGratuitySettings = locationSettings.autoGratuity ?? { enabled: false, percent: 0, minimumPartySize: 0 }

    return ok({
        rows,
        summary,
        settings: {
          enabled: autoGratuitySettings.enabled ?? false,
          percent: autoGratuitySettings.percent ?? 0,
          minimumPartySize: autoGratuitySettings.minimumPartySize ?? 0,
        },
      })
  } catch (error) {
    console.error('Failed to generate gratuity report:', error)
    return err('Failed to generate gratuity report', 500)
  }
})

function round(value: number): number {
  return Math.round(value * 100) / 100
}
