import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { emitToLocation } from '@/lib/socket-server'

/**
 * Check for overlapping shifts for the same employee on the same date.
 * An overlap exists when: newStart < existingEnd AND newEnd > existingStart
 *
 * Returns the first overlapping shift found, or null if no overlap.
 */
async function findOverlappingShift(
  employeeId: string,
  date: Date,
  startTime: string,
  endTime: string,
  excludeShiftId?: string,
) {
  // Find all shifts for this employee on this date (across all schedules)
  const existingShifts = await db.scheduledShift.findMany({
    where: {
      employeeId,
      date,
      deletedAt: null,
      ...(excludeShiftId ? { id: { not: excludeShiftId } } : {}),
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      scheduleId: true,
    },
  })

  // Convert HH:MM to minutes for comparison
  const toMinutes = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    return h * 60 + m
  }

  const newStart = toMinutes(startTime)
  const newEnd = toMinutes(endTime)

  for (const existing of existingShifts) {
    const existStart = toMinutes(existing.startTime)
    const existEnd = toMinutes(existing.endTime)

    // Overlap check: newStart < existingEnd AND newEnd > existingStart
    if (newStart < existEnd && newEnd > existStart) {
      return existing
    }
  }

  return null
}

// POST - Add shift to schedule
export const POST = withVenue(withAuth('ADMIN', async function POST(
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

    // Auth check — require staff scheduling permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.employeeId
    const auth = await requirePermission(resolvedEmployeeId, schedule.locationId, PERMISSIONS.STAFF_SCHEDULING)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Check for time-based overlapping shifts (not just same-day same-schedule)
    const overlap = await findOverlappingShift(
      employeeId,
      new Date(date),
      startTime,
      endTime,
    )

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

    const response: Record<string, unknown> = {
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
    }

    // Return warning (not error) if overlap exists — client can still show it
    if (overlap) {
      response.warning = `This shift overlaps with an existing shift for this employee (${overlap.startTime}-${overlap.endTime})`
    }

    void notifyDataChanged({ locationId: schedule.locationId, domain: 'scheduling', action: 'created', entityId: shift.id })
    void emitToLocation(schedule.locationId, 'schedules:changed', { trigger: 'shift-created' }).catch(() => {})

    return NextResponse.json({ data: response })
  } catch (error) {
    console.error('Failed to create shift:', error)
    return NextResponse.json({ error: 'Failed to create shift' }, { status: 500 })
  }
}))

// PUT - Bulk update shifts
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
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

    // Auth check — require staff scheduling permission
    const putActor = await getActorFromRequest(request)
    const putAuth = await requirePermission(putActor.employeeId, schedule.locationId, PERMISSIONS.STAFF_SCHEDULING)
    if (!putAuth.authorized) return NextResponse.json({ error: putAuth.error }, { status: putAuth.status })

    // Delete existing shifts not in the update
    const existingIds = shifts.filter(s => s.id).map(s => s.id!)
    await db.scheduledShift.deleteMany({
      where: {
        scheduleId,
        id: { notIn: existingIds },
      },
    })

    // Upsert shifts and collect overlap warnings
    const results = []
    const warnings: string[] = []
    for (const shift of shifts) {
      // Check for overlaps (exclude this shift's own ID if updating)
      const overlap = await findOverlappingShift(
        shift.employeeId,
        new Date(shift.date),
        shift.startTime,
        shift.endTime,
        shift.id,
      )

      if (overlap) {
        warnings.push(
          `Shift for employee ${shift.employeeId} on ${shift.date} (${shift.startTime}-${shift.endTime}) overlaps with existing shift (${overlap.startTime}-${overlap.endTime})`
        )
      }

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

    const response: Record<string, unknown> = {
      message: 'Shifts updated',
      count: results.length,
    }

    if (warnings.length > 0) {
      response.warnings = warnings
    }

    void notifyDataChanged({ locationId: schedule.locationId, domain: 'scheduling', action: 'updated', entityId: scheduleId })
    void emitToLocation(schedule.locationId, 'schedules:changed', { trigger: 'shifts-bulk-updated' }).catch(() => {})

    return NextResponse.json({ data: response })
  } catch (error) {
    console.error('Failed to update shifts:', error)
    return NextResponse.json({ error: 'Failed to update shifts' }, { status: 500 })
  }
}))
