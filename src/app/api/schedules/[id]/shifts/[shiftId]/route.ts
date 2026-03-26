import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { emitToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('schedules.id.shifts.shiftId')

/**
 * Check for overlapping shifts for the same employee on the same date.
 * An overlap exists when: newStart < existingEnd AND newEnd > existingStart
 */
async function findOverlappingShift(
  employeeId: string,
  date: Date,
  startTime: string,
  endTime: string,
  excludeShiftId: string,
) {
  const existingShifts = await db.scheduledShift.findMany({
    where: {
      employeeId,
      date,
      deletedAt: null,
      id: { not: excludeShiftId },
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
    },
  })

  const toMinutes = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    return h * 60 + m
  }

  const newStart = toMinutes(startTime)
  const newEnd = toMinutes(endTime)

  for (const existing of existingShifts) {
    const existStart = toMinutes(existing.startTime)
    const existEnd = toMinutes(existing.endTime)

    if (newStart < existEnd && newEnd > existStart) {
      return existing
    }
  }

  return null
}

// PUT - Update an individual shift
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shiftId: string }> }
) {
  try {
    const { id: scheduleId, shiftId } = await params
    const body = await request.json()
    const {
      employeeId,
      date,
      startTime,
      endTime,
      roleId,
      breakMinutes,
      notes,
    } = body as {
      employeeId?: string
      date?: string
      startTime?: string
      endTime?: string
      roleId?: string | null
      breakMinutes?: number
      notes?: string | null
    }

    const shift = await db.scheduledShift.findUnique({ where: { id: shiftId } })
    if (!shift) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    }

    if (shift.scheduleId !== scheduleId) {
      return NextResponse.json(
        { error: 'Shift does not belong to this schedule' },
        { status: 400 }
      )
    }

    if (shift.deletedAt !== null) {
      return NextResponse.json({ error: 'Shift has been deleted' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (employeeId !== undefined) updateData.employeeId = employeeId
    if (date !== undefined) updateData.date = new Date(date)
    if (startTime !== undefined) updateData.startTime = startTime
    if (endTime !== undefined) updateData.endTime = endTime
    if (roleId !== undefined) updateData.roleId = roleId ?? null
    if (breakMinutes !== undefined) updateData.breakMinutes = breakMinutes
    if (notes !== undefined) updateData.notes = notes

    // Check for overlap using final values (fallback to existing if not updating)
    const finalEmployeeId = employeeId ?? shift.employeeId
    const finalDate = date ? new Date(date) : shift.date
    const finalStartTime = startTime ?? shift.startTime
    const finalEndTime = endTime ?? shift.endTime

    const overlap = await findOverlappingShift(
      finalEmployeeId,
      finalDate,
      finalStartTime,
      finalEndTime,
      shiftId,
    )

    const updated = await db.scheduledShift.update({
      where: { id: shiftId },
      data: updateData,
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
        id: updated.id,
        employee: {
          id: updated.employee.id,
          name:
            updated.employee.displayName ||
            `${updated.employee.firstName} ${updated.employee.lastName}`,
        },
        role: updated.role ? { id: updated.role.id, name: updated.role.name } : null,
        date: updated.date.toISOString(),
        startTime: updated.startTime,
        endTime: updated.endTime,
        breakMinutes: updated.breakMinutes,
        status: updated.status,
        notes: updated.notes,
      },
    }

    if (overlap) {
      response.warning = `This shift overlaps with an existing shift for this employee (${overlap.startTime}-${overlap.endTime})`
    }

    void notifyDataChanged({ locationId: shift.locationId, domain: 'scheduling', action: 'updated', entityId: shiftId })
    void pushUpstream()
    void emitToLocation(shift.locationId, 'schedules:changed', { trigger: 'shift-updated' }).catch(err => log.warn({ err }, 'socket emit failed'))

    return NextResponse.json({ data: response })
  } catch (error) {
    console.error('Failed to update shift:', error)
    return NextResponse.json({ error: 'Failed to update shift' }, { status: 500 })
  }
}))

// DELETE - Soft-delete an individual shift
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shiftId: string }> }
) {
  try {
    const { id: scheduleId, shiftId } = await params

    const shift = await db.scheduledShift.findUnique({ where: { id: shiftId } })
    if (!shift) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    }

    if (shift.scheduleId !== scheduleId) {
      return NextResponse.json(
        { error: 'Shift does not belong to this schedule' },
        { status: 400 }
      )
    }

    if (shift.deletedAt !== null) {
      return NextResponse.json({ error: 'Shift already deleted' }, { status: 404 })
    }

    await db.scheduledShift.update({
      where: { id: shiftId },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: shift.locationId, domain: 'scheduling', action: 'deleted', entityId: shiftId })
    void pushUpstream()
    void emitToLocation(shift.locationId, 'schedules:changed', { trigger: 'shift-deleted' }).catch(err => log.warn({ err }, 'socket emit failed'))

    return NextResponse.json({ data: { message: 'Shift deleted' } })
  } catch (error) {
    console.error('Failed to delete shift:', error)
    return NextResponse.json({ error: 'Failed to delete shift' }, { status: 500 })
  }
}))
