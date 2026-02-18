import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List shifts with optional filters
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status') // 'open' or 'closed'
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const shifts = await db.shift.findMany({
      where: {
        locationId,
        ...(employeeId ? { employeeId } : {}),
        ...(status ? { status } : {}),
        ...(startDate || endDate ? {
          startedAt: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(endDate) } : {}),
          },
        } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            role: {
              select: { permissions: true },
            },
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    })

    return NextResponse.json({ data: {
      shifts: shifts.map(shift => ({
        id: shift.id,
        employee: {
          id: shift.employee.id,
          name: shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`,
          permissions: Array.isArray(shift.employee.role?.permissions) ? shift.employee.role.permissions as string[] : [],
        },
        startedAt: shift.startedAt.toISOString(),
        endedAt: shift.endedAt?.toISOString() || null,
        status: shift.status,
        startingCash: Number(shift.startingCash),
        expectedCash: shift.expectedCash ? Number(shift.expectedCash) : null,
        actualCash: shift.actualCash ? Number(shift.actualCash) : null,
        variance: shift.variance ? Number(shift.variance) : null,
        totalSales: shift.totalSales ? Number(shift.totalSales) : null,
        cashSales: shift.cashSales ? Number(shift.cashSales) : null,
        cardSales: shift.cardSales ? Number(shift.cardSales) : null,
        tipsDeclared: shift.tipsDeclared ? Number(shift.tipsDeclared) : null,
        notes: shift.notes,
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch shifts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shifts' },
      { status: 500 }
    )
  }
})

// POST - Start a new shift
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, startingCash, notes, drawerId, workingRoleId, cashHandlingMode } = body as {
      locationId: string
      employeeId: string
      startingCash?: number
      notes?: string
      drawerId?: string
      workingRoleId?: string
      cashHandlingMode?: string // "drawer" | "purse" | "none"
    }

    if (!locationId || !employeeId) {
      return NextResponse.json(
        { error: 'Location ID and Employee ID are required' },
        { status: 400 }
      )
    }

    const mode = cashHandlingMode || 'drawer'

    // Validate based on cash handling mode
    if (mode === 'drawer') {
      if (startingCash === undefined || startingCash < 0) {
        return NextResponse.json(
          { error: 'Starting cash amount is required for drawer mode' },
          { status: 400 }
        )
      }
      if (!drawerId) {
        return NextResponse.json(
          { error: 'Drawer selection is required for drawer mode' },
          { status: 400 }
        )
      }
    } else if (mode === 'purse') {
      if (startingCash === undefined || startingCash < 0) {
        return NextResponse.json(
          { error: 'Starting purse amount is required' },
          { status: 400 }
        )
      }
    }
    // mode === 'none' — no cash validation needed

    // Check if employee already has an open shift
    const existingShift = await db.shift.findFirst({
      where: {
        employeeId,
        locationId,
        status: 'open',
      },
    })

    if (existingShift) {
      return NextResponse.json(
        { error: 'Employee already has an open shift. Please close it first.' },
        { status: 400 }
      )
    }

    // If drawer mode, verify drawer isn't already claimed
    if (drawerId) {
      const drawerClaimed = await db.shift.findFirst({
        where: {
          drawerId,
          status: 'open',
          deletedAt: null,
        },
        include: {
          employee: {
            select: { displayName: true, firstName: true, lastName: true },
          },
        },
      })
      if (drawerClaimed) {
        const claimedBy = drawerClaimed.employee.displayName
          || `${drawerClaimed.employee.firstName} ${drawerClaimed.employee.lastName}`
        return NextResponse.json(
          { error: `Drawer already claimed by ${claimedBy}` },
          { status: 409 }
        )
      }
    }

    // Look up active time clock entry to link
    const activeClockEntry = await db.timeClockEntry.findFirst({
      where: {
        employeeId,
        clockOut: null,
        deletedAt: null,
      },
      select: { id: true },
    })

    // Create new shift
    const shift = await db.shift.create({
      data: {
        locationId,
        employeeId,
        startingCash: startingCash ?? 0,
        notes,
        status: 'open',
        timeClockEntryId: activeClockEntry?.id || null,
        ...(drawerId ? { drawerId } : {}),
        ...(workingRoleId ? { workingRoleId } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    })

    return NextResponse.json({ data: {
      shift: {
        id: shift.id,
        employee: {
          id: shift.employee.id,
          name: shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`,
        },
        startedAt: shift.startedAt.toISOString(),
        startingCash: Number(shift.startingCash),
        status: shift.status,
      },
      message: 'Shift started successfully',
    } })
  } catch (error) {
    console.error('Failed to start shift:', error)
    return NextResponse.json(
      { error: 'Failed to start shift' },
      { status: 500 }
    )
  }
})
