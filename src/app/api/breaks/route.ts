import { NextRequest } from 'next/server'
import { db as prisma } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// GET - List breaks for employee/time clock entry
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const timeClockEntryId = searchParams.get('timeClockEntryId')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (employeeId) where.employeeId = employeeId
    if (timeClockEntryId) where.timeClockEntryId = timeClockEntryId
    if (status) where.status = status

    const breaks = await prisma.break.findMany({
      where,
      orderBy: { startedAt: 'desc' },
    })

    return ok({
      breaks: breaks.map(b => ({
        id: b.id,
        employeeId: b.employeeId,
        timeClockEntryId: b.timeClockEntryId,
        breakType: b.breakType,
        startedAt: b.startedAt,
        endedAt: b.endedAt,
        duration: b.duration,
        status: b.status,
        notes: b.notes,
      })),
    })
  } catch (error) {
    console.error('Breaks error:', error)
    return err('Failed to fetch breaks', 500)
  }
})

// POST - Start a break
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { employeeId, timeClockEntryId, breakType, notes } = body

    if (!employeeId || !timeClockEntryId) {
      return err('Employee ID and time clock entry ID required')
    }

    // Get time clock entry to get locationId
    const timeClockEntry = await prisma.timeClockEntry.findUnique({
      where: { id: timeClockEntryId },
    })

    if (!timeClockEntry) {
      return notFound('Time clock entry not found')
    }

    // Check for active break
    const activeBreak = await prisma.break.findFirst({
      where: {
        timeClockEntryId,
        status: 'active',
      },
    })

    if (activeBreak) {
      return err('Already on break')
    }

    const breakEntry = await prisma.break.create({
      data: {
        locationId: timeClockEntry.locationId,
        employeeId,
        timeClockEntryId,
        breakType: breakType || 'unpaid',
        notes,
        status: 'active',
      },
    })

    pushUpstream()

    return ok({
      break: {
        id: breakEntry.id,
        breakType: breakEntry.breakType,
        startedAt: breakEntry.startedAt,
        status: breakEntry.status,
      },
    })
  } catch (error) {
    console.error('Start break error:', error)
    return err('Failed to start break', 500)
  }
}))

// PUT - End a break
export const PUT = withVenue(withAuth(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { breakId, timeClockEntryId } = body

    let breakEntry

    if (breakId) {
      breakEntry = await prisma.break.findUnique({
        where: { id: breakId },
      })
    } else if (timeClockEntryId) {
      breakEntry = await prisma.break.findFirst({
        where: {
          timeClockEntryId,
          status: 'active',
        },
      })
    }

    if (!breakEntry) {
      return notFound('Break not found')
    }

    if (breakEntry.status !== 'active') {
      return err('Break is not active')
    }

    const now = new Date()
    const duration = Math.floor((now.getTime() - new Date(breakEntry.startedAt).getTime()) / 60000)

    const updatedBreak = await prisma.break.update({
      where: { id: breakEntry.id },
      data: {
        endedAt: now,
        duration,
        status: 'completed',
      },
    })

    // Update time clock entry break minutes
    await prisma.timeClockEntry.update({
      where: { id: breakEntry.timeClockEntryId },
      data: {
        breakMinutes: { increment: duration },
      },
    })

    pushUpstream()

    return ok({
      break: {
        id: updatedBreak.id,
        breakType: updatedBreak.breakType,
        startedAt: updatedBreak.startedAt,
        endedAt: updatedBreak.endedAt,
        duration: updatedBreak.duration,
        status: updatedBreak.status,
      },
    })
  } catch (error) {
    console.error('End break error:', error)
    return err('Failed to end break', 500)
  }
}))
