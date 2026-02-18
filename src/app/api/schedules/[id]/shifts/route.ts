import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Add shift to schedule
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: scheduleId } = await params
    const body = await request.json()
    const {
      employeeId,
      date,
      startTime,
      endTime,
      roleId,
      breakMinutes = 0,
      notes,
    } = body

    if (!employeeId || !date || !startTime || !endTime) {
      return NextResponse.json(
        { error: 'employeeId, date, startTime, and endTime are required' },
        { status: 400 }
      )
    }

    const schedule = await db.schedule.findUnique({ where: { id: scheduleId } })
    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    // Check for conflicts
    const conflictingShift = await db.scheduledShift.findFirst({
      where: {
        employeeId,
        date: new Date(date),
        scheduleId,
      },
    })

    if (conflictingShift) {
      return NextResponse.json(
        { error: 'Employee already has a shift scheduled for this day' },
        { status: 400 }
      )
    }

    const shift = await db.scheduledShift.create({
      data: {
        locationId: schedule.locationId,
        scheduleId,
        employeeId,
        date: new Date(date),
        startTime,
        endTime,
        roleId: roleId || null,
        breakMinutes,
        status: 'scheduled',
        notes,
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
        role: {
          select: { id: true, name: true },
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
        role: shift.role ? { id: shift.role.id, name: shift.role.name } : null,
        date: shift.date.toISOString(),
        startTime: shift.startTime,
        endTime: shift.endTime,
        breakMinutes: shift.breakMinutes,
        status: shift.status,
        notes: shift.notes,
      },
    } })
  } catch (error) {
    console.error('Failed to create shift:', error)
    return NextResponse.json({ error: 'Failed to create shift' }, { status: 500 })
  }
})

// PUT - Bulk update shifts
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: scheduleId } = await params
    const body = await request.json()
    const { shifts } = body as {
      shifts: {
        id?: string
        employeeId: string
        date: string
        startTime: string
        endTime: string
        roleId?: string
        breakMinutes?: number
        notes?: string
      }[]
    }

    const schedule = await db.schedule.findUnique({ where: { id: scheduleId } })
    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    // Delete existing shifts not in the update
    const existingIds = shifts.filter(s => s.id).map(s => s.id!)
    await db.scheduledShift.deleteMany({
      where: {
        scheduleId,
        id: { notIn: existingIds },
      },
    })

    // Upsert shifts
    const results = []
    for (const shift of shifts) {
      if (shift.id) {
        // Update existing
        const updated = await db.scheduledShift.update({
          where: { id: shift.id },
          data: {
            employeeId: shift.employeeId,
            date: new Date(shift.date),
            startTime: shift.startTime,
            endTime: shift.endTime,
            roleId: shift.roleId || null,
            breakMinutes: shift.breakMinutes || 0,
            notes: shift.notes,
          },
        })
        results.push(updated)
      } else {
        // Create new
        const created = await db.scheduledShift.create({
          data: {
            locationId: schedule.locationId,
            scheduleId,
            employeeId: shift.employeeId,
            date: new Date(shift.date),
            startTime: shift.startTime,
            endTime: shift.endTime,
            roleId: shift.roleId || null,
            breakMinutes: shift.breakMinutes || 0,
            status: 'scheduled',
            notes: shift.notes,
          },
        })
        results.push(created)
      }
    }

    return NextResponse.json({ data: {
      message: 'Shifts updated',
      count: results.length,
    } })
  } catch (error) {
    console.error('Failed to update shifts:', error)
    return NextResponse.json({ error: 'Failed to update shifts' }, { status: 500 })
  }
})
