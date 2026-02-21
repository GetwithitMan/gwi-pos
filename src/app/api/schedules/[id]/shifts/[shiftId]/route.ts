import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// PUT - Update an individual shift
export const PUT = withVenue(async function PUT(
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

    return NextResponse.json({
      data: {
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
      },
    })
  } catch (error) {
    console.error('Failed to update shift:', error)
    return NextResponse.json({ error: 'Failed to update shift' }, { status: 500 })
  }
})

// DELETE - Soft-delete an individual shift
export const DELETE = withVenue(async function DELETE(
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

    return NextResponse.json({ data: { message: 'Shift deleted' } })
  } catch (error) {
    console.error('Failed to delete shift:', error)
    return NextResponse.json({ error: 'Failed to delete shift' }, { status: 500 })
  }
})
