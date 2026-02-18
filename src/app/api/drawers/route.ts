import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List drawers at a location, with availability status
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const drawers = await db.drawer.findMany({
      where: {
        locationId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        shifts: {
          where: {
            status: 'open',
            deletedAt: null,
          },
          select: {
            id: true,
            employeeId: true,
            employee: {
              select: {
                displayName: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ data: {
      drawers: drawers.map(drawer => ({
        id: drawer.id,
        name: drawer.name,
        deviceId: drawer.deviceId,
        isAvailable: drawer.shifts.length === 0,
        claimedBy: drawer.shifts.length > 0
          ? {
              shiftId: drawer.shifts[0].id,
              employeeId: drawer.shifts[0].employeeId,
              employeeName: drawer.shifts[0].employee.displayName
                || `${drawer.shifts[0].employee.firstName} ${drawer.shifts[0].employee.lastName}`,
            }
          : null,
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch drawers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch drawers' },
      { status: 500 }
    )
  }
})
