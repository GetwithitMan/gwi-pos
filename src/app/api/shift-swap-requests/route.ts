import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { Prisma, ShiftSwapRequestStatus } from '@/generated/prisma/client'
import { err, ok } from '@/lib/api-response'

// GET - List shift requests for the current location
// Query params: locationId (required), status? (filter), employeeId? (filter as requestedToEmployeeId),
//   requestedByEmployeeId? (filter), type? (swap|cover|drop)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const requestedByEmployeeId = searchParams.get('requestedByEmployeeId')
    const type = searchParams.get('type')

    if (!locationId) {
      return err('Location ID is required')
    }

    const where: Prisma.ShiftSwapRequestWhereInput = {
      locationId,
      deletedAt: null,
    }

    if (status) {
      where.status = status as ShiftSwapRequestStatus
    }

    if (employeeId) {
      where.requestedToEmployeeId = employeeId
    }

    if (requestedByEmployeeId) {
      where.requestedByEmployeeId = requestedByEmployeeId
    }

    if (type) {
      where.type = type as 'swap' | 'cover' | 'drop'
    }

    const requests = await db.shiftSwapRequest.findMany({
      where,
      include: {
        shift: {
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
            status: true,
          },
        },
        requestedByEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        requestedToEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        approvedByEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return ok({ requests })
  } catch (error) {
    console.error('Failed to fetch shift requests:', error)
    return err('Failed to fetch shift requests', 500)
  }
})
