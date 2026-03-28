import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// GET - List drawers at a location, with availability status
// No auth required — POS terminals need drawer status for cash operations
export const GET = withVenue(async function GET(
  request: NextRequest,
) {
  try {
    const locationId = request.nextUrl.searchParams.get('locationId')
    if (!locationId) {
      return err('locationId is required')
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

    return ok({
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
    })
  } catch (error) {
    console.error('Failed to fetch drawers:', error)
    return err('Failed to fetch drawers', 500)
  }
})
