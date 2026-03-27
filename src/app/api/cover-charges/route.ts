/**
 * Cover Charge / Door Entry Management API
 *
 * GET  /api/cover-charges — list cover charges for today (or date range)
 * POST /api/cover-charges — record a cover charge entry
 *
 * Uses raw SQL because CoverCharge is not in the Prisma schema
 * (table created via migration 027).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getCurrentBusinessDay, getBusinessDayRange } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'
import { emitToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('cover-charges')

interface CoverChargeRow {
  id: string
  locationId: string
  employeeId: string
  amount: number | { toNumber?: () => number }
  paymentMethod: string
  guestCount: number
  notes: string | null
  isVip: boolean
  isComped: boolean
  compReason: string | null
  createdAt: Date
}

// GET /api/cover-charges — list cover charges for a date range (default: today)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    // Permission check — use MGR_PAY_IN_OUT as closest existing permission for cash ops
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date range using business day boundaries
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime
    const coverSettings = locationSettings.coverCharge
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct date boundaries
    const timezone = await getLocationTimezone(locationId)

    let rangeStart: Date
    let rangeEnd: Date

    if (startDate && endDate) {
      const startRange = getBusinessDayRange(startDate, dayStartTime, timezone)
      const endRange = getBusinessDayRange(endDate, dayStartTime, timezone)
      rangeStart = startRange.start
      rangeEnd = endRange.end
    } else if (startDate) {
      const range = getBusinessDayRange(startDate, dayStartTime, timezone)
      rangeStart = range.start
      rangeEnd = range.end
    } else {
      const current = getCurrentBusinessDay(dayStartTime, timezone)
      rangeStart = current.start
      rangeEnd = current.end
    }

    const rows = await db.$queryRawUnsafe<CoverChargeRow[]>(
      `SELECT * FROM "CoverCharge"
       WHERE "locationId" = $1 AND "deletedAt" IS NULL
         AND "createdAt" >= $2 AND "createdAt" <= $3
       ORDER BY "createdAt" DESC
       LIMIT 5000`,
      locationId,
      rangeStart,
      rangeEnd
    )

    // Compute aggregates
    let totalCollected = 0
    let cashTotal = 0
    let cardTotal = 0
    let doorCount = 0
    let vipCount = 0
    let compCount = 0

    for (const row of rows) {
      const amt = typeof row.amount === 'object' && row.amount && 'toNumber' in row.amount
        ? (row.amount as { toNumber: () => number }).toNumber()
        : Number(row.amount) || 0
      totalCollected += amt
      doorCount += row.guestCount || 1
      if (row.paymentMethod === 'cash') cashTotal += amt
      else cardTotal += amt
      if (row.isVip) vipCount++
      if (row.isComped) compCount++
    }

    const maxCapacity = coverSettings?.maxCapacity || 0
    const capacityRemaining = maxCapacity > 0 ? Math.max(0, maxCapacity - doorCount) : null

    return NextResponse.json({
      data: {
        entries: rows.map(r => ({
          id: r.id,
          employeeId: r.employeeId,
          amount: typeof r.amount === 'object' && r.amount && 'toNumber' in r.amount
            ? (r.amount as { toNumber: () => number }).toNumber()
            : Number(r.amount) || 0,
          paymentMethod: r.paymentMethod,
          guestCount: r.guestCount,
          notes: r.notes,
          isVip: r.isVip,
          isComped: r.isComped,
          compReason: r.compReason,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        })),
        totalCollected: Math.round(totalCollected * 100) / 100,
        cashTotal: Math.round(cashTotal * 100) / 100,
        cardTotal: Math.round(cardTotal * 100) / 100,
        doorCount,
        vipCount,
        compCount,
        maxCapacity,
        capacityRemaining,
        entryCount: rows.length,
      },
    })
  } catch (error) {
    console.error('[GET /api/cover-charges] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch cover charges' }, { status: 500 })
  }
})

// POST /api/cover-charges — record a cover charge entry
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      amount,
      paymentMethod,
      guestCount,
      notes,
      isVip,
      isComped,
      compReason,
    } = body

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    // Resolve employeeId from authenticated session, fall back to body for Android clients
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    if (!employeeId) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 })
    }
    if (paymentMethod && !['cash', 'card'].includes(paymentMethod)) {
      return NextResponse.json({ error: 'Payment method must be "cash" or "card"' }, { status: 400 })
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Load settings
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const coverSettings = locationSettings.coverCharge

    // Determine final amount
    let finalAmount = Number(amount) || (coverSettings?.defaultAmount ?? 10)
    const isVipEntry = Boolean(isVip)
    const isCompedEntry = Boolean(isComped)

    // VIP bypass: amount = 0 but still track the entry
    if (isVipEntry && coverSettings?.vipBypass) {
      finalAmount = 0
    }
    // Comped entries
    if (isCompedEntry) {
      finalAmount = 0
    }

    // Capacity check
    if (coverSettings?.maxCapacity && coverSettings.maxCapacity > 0 && coverSettings.trackDoorCount) {
      const dayStartTime = locationSettings.businessDay.dayStartTime
      // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct business day
      const capTz = await getLocationTimezone(locationId)
      const current = getCurrentBusinessDay(dayStartTime, capTz)

      const countRows = await db.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COALESCE(SUM("guestCount"), 0) AS count FROM "CoverCharge"
         WHERE "locationId" = $1 AND "deletedAt" IS NULL
           AND "createdAt" >= $2 AND "createdAt" <= $3`,
        locationId,
        current.start,
        current.end
      )
      const currentCount = Number(countRows[0]?.count ?? 0)
      const incomingGuests = Number(guestCount) || 1

      if (currentCount + incomingGuests > coverSettings.maxCapacity) {
        return NextResponse.json(
          { error: `At capacity (${currentCount}/${coverSettings.maxCapacity}). Cannot admit ${incomingGuests} more guest(s).` },
          { status: 400 }
        )
      }
    }

    // Insert cover charge
    const rows = await db.$queryRawUnsafe<CoverChargeRow[]>(
      `INSERT INTO "CoverCharge" ("locationId", "employeeId", "amount", "paymentMethod", "guestCount", "notes", "isVip", "isComped", "compReason")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      locationId,
      employeeId,
      finalAmount,
      paymentMethod || 'cash',
      Number(guestCount) || 1,
      notes?.trim() || null,
      isVipEntry,
      isCompedEntry,
      isCompedEntry ? (compReason?.trim() || null) : null
    )

    const record = rows[0]

    // Audit trail
    console.log(`[AUDIT] COVER_CHARGE: $${finalAmount} x${record.guestCount} by employee ${employeeId}${isVipEntry ? ' (VIP)' : ''}${isCompedEntry ? ' (COMPED)' : ''} — locationId: ${locationId}`)

    // Emit socket event for real-time dashboard updates
    void emitToLocation(locationId, 'cover:entry-recorded', {
      id: record.id,
      amount: finalAmount,
      paymentMethod: record.paymentMethod,
      guestCount: record.guestCount,
      isVip: record.isVip,
      isComped: record.isComped,
      employeeId: record.employeeId,
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: {
        id: record.id,
        amount: typeof record.amount === 'object' && record.amount && 'toNumber' in record.amount
          ? (record.amount as { toNumber: () => number }).toNumber()
          : Number(record.amount) || 0,
        paymentMethod: record.paymentMethod,
        guestCount: record.guestCount,
        notes: record.notes,
        isVip: record.isVip,
        isComped: record.isComped,
        compReason: record.compReason,
        createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
      },
    })
  } catch (error) {
    console.error('[POST /api/cover-charges] Error:', error)
    return NextResponse.json({ error: 'Failed to record cover charge' }, { status: 500 })
  }
})
