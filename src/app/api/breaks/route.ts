import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'

// GET - List breaks for employee/time clock entry
export async function GET(request: NextRequest) {
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

    return NextResponse.json({
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
    return NextResponse.json({ error: 'Failed to fetch breaks' }, { status: 500 })
  }
}

// POST - Start a break
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { employeeId, timeClockEntryId, breakType, notes } = body

    if (!employeeId || !timeClockEntryId) {
      return NextResponse.json({
        error: 'Employee ID and time clock entry ID required',
      }, { status: 400 })
    }

    // Get time clock entry to get locationId
    const timeClockEntry = await prisma.timeClockEntry.findUnique({
      where: { id: timeClockEntryId },
    })

    if (!timeClockEntry) {
      return NextResponse.json({ error: 'Time clock entry not found' }, { status: 404 })
    }

    // Check for active break
    const activeBreak = await prisma.break.findFirst({
      where: {
        timeClockEntryId,
        status: 'active',
      },
    })

    if (activeBreak) {
      return NextResponse.json({ error: 'Already on break' }, { status: 400 })
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

    return NextResponse.json({
      break: {
        id: breakEntry.id,
        breakType: breakEntry.breakType,
        startedAt: breakEntry.startedAt,
        status: breakEntry.status,
      },
    })
  } catch (error) {
    console.error('Start break error:', error)
    return NextResponse.json({ error: 'Failed to start break' }, { status: 500 })
  }
}

// PUT - End a break
export async function PUT(request: NextRequest) {
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
      return NextResponse.json({ error: 'Break not found' }, { status: 404 })
    }

    if (breakEntry.status !== 'active') {
      return NextResponse.json({ error: 'Break is not active' }, { status: 400 })
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

    return NextResponse.json({
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
    return NextResponse.json({ error: 'Failed to end break' }, { status: 500 })
  }
}
