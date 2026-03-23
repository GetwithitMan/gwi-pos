import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { Prisma, ShiftSwapRequestStatus } from '@/generated/prisma/client'

// GET - List shift requests for the current location
// Query params: locationId (required), status? (filter), employeeId? (filter as requestedToEmployeeId),
//   requestedByEmployeeId? (filter), type? (swap|cover|drop)
export const GET = withVenue(withAuth(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const requestedByEmployeeId = searchParams.get('requestedByEmployeeId')
    const type = searchParams.get('type')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
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

    return NextResponse.json({ data: { requests } })
  } catch (error) {
    console.error('Failed to fetch shift requests:', error)
    return NextResponse.json({ error: 'Failed to fetch shift requests' }, { status: 500 })
  }
}))
