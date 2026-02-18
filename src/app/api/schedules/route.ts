import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List schedules
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const weekStart = searchParams.get('weekStart')
    const status = searchParams.get('status')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const where: Record<string, unknown> = { locationId }
    if (weekStart) {
      where.weekStart = new Date(weekStart)
    }
    if (status) {
      where.status = status
    }

    const schedules = await db.schedule.findMany({
      where,
      include: {
        shifts: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
            role: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { weekStart: 'desc' },
      take: 20,
    })

    return NextResponse.json({ data: {
      schedules: schedules.map(s => ({
        id: s.id,
        weekStart: s.weekStart.toISOString(),
        weekEnd: s.weekEnd.toISOString(),
        status: s.status,
        publishedAt: s.publishedAt?.toISOString() || null,
        notes: s.notes,
        shiftCount: s.shifts.length,
        shifts: s.shifts.map(shift => ({
          id: shift.id,
          employee: {
            id: shift.employee.id,
            name: shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`,
          },
          role: shift.role ? { id: shift.role.id, name: shift.role.name } : null,
          date: shift.date.toISOString(),
          startTime: shift.startTime,
          endTime: shift.endTime,
          breakMinutes: shift.breakMinutes,
          status: shift.status,
        })),
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch schedules:', error)
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 })
  }
})

// POST - Create a new schedule
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, weekStart, notes } = body

    if (!locationId || !weekStart) {
      return NextResponse.json(
        { error: 'locationId and weekStart are required' },
        { status: 400 }
      )
    }

    // Calculate week end (Sunday)
    const start = new Date(weekStart)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    end.setHours(23, 59, 59, 999)

    // Check for existing schedule
    const existing = await db.schedule.findFirst({
      where: { locationId, weekStart: start },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'A schedule already exists for this week' },
        { status: 400 }
      )
    }

    const schedule = await db.schedule.create({
      data: {
        locationId,
        weekStart: start,
        weekEnd: end,
        status: 'draft',
        notes,
      },
    })

    return NextResponse.json({ data: {
      schedule: {
        id: schedule.id,
        weekStart: schedule.weekStart.toISOString(),
        weekEnd: schedule.weekEnd.toISOString(),
        status: schedule.status,
        notes: schedule.notes,
      },
    } })
  } catch (error) {
    console.error('Failed to create schedule:', error)
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 })
  }
})
