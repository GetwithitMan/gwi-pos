import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getCurrentBusinessDay, getBusinessDayRange } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { emitToLocation } from '@/lib/socket-server'

// Parse category from stored reason format: "[Category] Reason text"
function parseCategoryFromReason(reason: string): { category: string | null; reason: string } {
  const match = reason.match(/^\[([^\]]+)\]\s*(.*)$/)
  if (match) {
    return { category: match[1], reason: match[2] || '' }
  }
  return { category: null, reason }
}

// GET /api/paid-in-out — list paid in/out records for location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    const drawerId = searchParams.get('drawerId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const type = searchParams.get('type') // 'in' | 'out'
    const employeeId = searchParams.get('filterEmployeeId')
    const categoryFilter = searchParams.get('category')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date range using business day boundaries
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (drawerId) where.drawerId = drawerId
    if (type === 'in' || type === 'out') where.type = type
    if (employeeId) where.employeeId = employeeId
    // Category filter: encoded as "[Category] " prefix in reason field
    if (categoryFilter) {
      where.reason = { startsWith: `[${categoryFilter}]` }
    }

    // Date filtering
    if (startDate && endDate) {
      const startRange = getBusinessDayRange(startDate, dayStartTime)
      const endRange = getBusinessDayRange(endDate, dayStartTime)
      where.createdAt = { gte: startRange.start, lte: endRange.end }
    } else if (startDate) {
      const range = getBusinessDayRange(startDate, dayStartTime)
      where.createdAt = { gte: range.start, lte: range.end }
    } else {
      // Default: current business day
      const current = getCurrentBusinessDay(dayStartTime)
      where.createdAt = { gte: current.start, lte: current.end }
    }

    const records = await db.paidInOut.findMany({
      where,
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        approver: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        drawer: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })

    // Compute summary
    let totalPaidIn = 0
    let totalPaidOut = 0
    for (const r of records) {
      const amount = Number(r.amount) || 0
      if (r.type === 'in') {
        totalPaidIn += amount
      } else {
        totalPaidOut += amount
      }
    }

    return NextResponse.json({
      data: {
        records: records.map(r => {
          const parsed = parseCategoryFromReason(r.reason)
          return {
            id: r.id,
            type: r.type === 'in' ? 'paid_in' : 'paid_out',
            amount: Number(r.amount),
            reason: parsed.reason,
            category: parsed.category,
            reference: r.reference,
            employeeId: r.employeeId,
            employeeName: r.employee.displayName || `${r.employee.firstName} ${r.employee.lastName}`,
            approvedBy: r.approvedBy,
            approverName: r.approver
              ? r.approver.displayName || `${r.approver.firstName} ${r.approver.lastName}`
              : null,
            drawerId: r.drawerId,
            drawerName: r.drawer.name,
            createdAt: r.createdAt.toISOString(),
          }
        }),
        summary: {
          totalPaidIn: Math.round(totalPaidIn * 100) / 100,
          totalPaidOut: Math.round(totalPaidOut * 100) / 100,
          net: Math.round((totalPaidIn - totalPaidOut) * 100) / 100,
          count: records.length,
        },
      },
    })
  } catch (error) {
    console.error('Failed to fetch paid in/out records:', error)
    return NextResponse.json({ error: 'Failed to fetch paid in/out records' }, { status: 500 })
  }
})

// POST /api/paid-in-out — create a paid in or paid out record
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      type, // 'paid_in' | 'paid_out'
      amount,
      reason,
      reference,
      category, // Optional category: 'Cash Advance', 'Vendor Payment', etc.
      drawerId,
      employeeId,
      approvedBy,
    } = body

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }
    if (!employeeId) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 })
    }
    if (!type || (type !== 'paid_in' && type !== 'paid_out')) {
      return NextResponse.json({ error: 'Type must be "paid_in" or "paid_out"' }, { status: 400 })
    }
    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 })
    }
    if (!reason || reason.trim().length === 0) {
      return NextResponse.json({ error: 'Reason is required' }, { status: 400 })
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Manager approval required for paid-out over $100
    const managerId = body.managerId as string | undefined
    if (type === 'paid_out' && Number(amount) > 100) {
      if (!managerId) {
        return NextResponse.json(
          { error: 'Manager approval required for paid-out over $100' },
          { status: 400 }
        )
      }
      // Verify manager exists and has manager permissions
      const manager = await adminDb.employee.findFirst({
        where: { id: managerId, locationId, isActive: true, deletedAt: null },
        include: { role: true },
      })
      if (!manager) {
        return NextResponse.json(
          { error: 'Invalid manager ID' },
          { status: 400 }
        )
      }
      console.log(`[AUDIT] PAID_OUT approved by manager ${managerId} (${manager.firstName} ${manager.lastName})`)
    }

    // Resolve drawer — use provided drawerId or find first active drawer
    let resolvedDrawerId = drawerId
    if (!resolvedDrawerId) {
      const activeDrawer = await db.drawer.findFirst({
        where: { locationId, isActive: true, deletedAt: null },
        select: { id: true },
      })
      if (!activeDrawer) {
        return NextResponse.json({ error: 'No active drawer found at this location' }, { status: 400 })
      }
      resolvedDrawerId = activeDrawer.id
    }

    // Map type to enum value
    const dbType = type === 'paid_in' ? 'in' : 'out'

    // Store category in reason with bracket prefix: "[Category] Reason"
    // This encodes category without requiring a schema migration
    const formattedReason = category
      ? `[${category.trim()}] ${reason.trim()}`
      : reason.trim()

    const record = await db.paidInOut.create({
      data: {
        locationId,
        drawerId: resolvedDrawerId,
        type: dbType,
        amount: Number(amount),
        reason: formattedReason,
        reference: reference?.trim() || null,
        employeeId,
        approvedBy: approvedBy || null,
      },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        approver: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        drawer: {
          select: { id: true, name: true },
        },
      },
    })

    // Audit trail for paid in/out
    console.log(`[AUDIT] PAID_${dbType.toUpperCase()}: $${Number(record.amount)} by employee ${employeeId} — reason: "${record.reason}", reference: "${record.reference || 'none'}", locationId: ${locationId}`)

    // Emit socket event for real-time updates
    void emitToLocation(locationId, 'drawer:paid_in_out', {
      id: record.id,
      type: type,
      amount: Number(record.amount),
      employeeId: record.employeeId,
      employeeName: record.employee.displayName || `${record.employee.firstName} ${record.employee.lastName}`,
      reason: record.reason,
      drawerId: record.drawerId,
      drawerName: record.drawer.name,
      createdAt: record.createdAt.toISOString(),
    }).catch(console.error)

    const parsedRecord = parseCategoryFromReason(record.reason)
    return NextResponse.json({
      data: {
        id: record.id,
        type: type,
        amount: Number(record.amount),
        reason: parsedRecord.reason,
        category: parsedRecord.category,
        reference: record.reference,
        employeeId: record.employeeId,
        employeeName: record.employee.displayName || `${record.employee.firstName} ${record.employee.lastName}`,
        approvedBy: record.approvedBy,
        approverName: record.approver
          ? record.approver.displayName || `${record.approver.firstName} ${record.approver.lastName}`
          : null,
        drawerId: record.drawerId,
        drawerName: record.drawer.name,
        createdAt: record.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to create paid in/out record:', error)
    return NextResponse.json({ error: 'Failed to create paid in/out record' }, { status: 500 })
  }
})
