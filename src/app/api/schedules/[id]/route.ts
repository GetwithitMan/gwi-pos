import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { emitToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('schedules.id')

// GET - Get schedule details
export const GET = withVenue(withAuth('ADMIN', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const schedule = await db.schedule.findUnique({
      where: { id },
      include: {
        shifts: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                hourlyRate: true,
              },
            },
            role: {
              select: { id: true, name: true },
            },
          },
          orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        },
      },
    })

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    // Group shifts by date
    const shiftsByDate: Record<string, typeof schedule.shifts> = {}
    schedule.shifts.forEach(shift => {
      const dateKey = shift.date.toISOString().split('T')[0]
      if (!shiftsByDate[dateKey]) {
        shiftsByDate[dateKey] = []
      }
      shiftsByDate[dateKey].push(shift)
    })

    // Calculate total scheduled hours
    let totalHours = 0
    let totalLaborCost = 0
    schedule.shifts.forEach(shift => {
      const [startH, startM] = shift.startTime.split(':').map(Number)
      const [endH, endM] = shift.endTime.split(':').map(Number)
      const hours = (endH + endM / 60) - (startH + startM / 60) - (shift.breakMinutes / 60)
      totalHours += Math.max(0, hours)
      totalLaborCost += hours * Number(shift.employee.hourlyRate || 0)
    })

    return NextResponse.json({ data: {
      schedule: {
        id: schedule.id,
        weekStart: schedule.weekStart.toISOString(),
        weekEnd: schedule.weekEnd.toISOString(),
        status: schedule.status,
        publishedAt: schedule.publishedAt?.toISOString() || null,
        notes: schedule.notes,
      },
      shifts: schedule.shifts.map(shift => ({
        id: shift.id,
        employee: {
          id: shift.employee.id,
          name: shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`,
          hourlyRate: Number(shift.employee.hourlyRate || 0),
        },
        role: shift.role ? { id: shift.role.id, name: shift.role.name } : null,
        date: shift.date.toISOString(),
        startTime: shift.startTime,
        endTime: shift.endTime,
        breakMinutes: shift.breakMinutes,
        status: shift.status,
        notes: shift.notes,
        sevenShiftsShiftId: (shift as Record<string, unknown>).sevenShiftsShiftId as string | null ?? null,
      })),
      shiftsByDate: Object.entries(shiftsByDate).map(([date, shifts]) => ({
        date,
        shifts: shifts.map(s => ({
          id: s.id,
          employeeId: s.employee.id,
          employeeName: s.employee.displayName || `${s.employee.firstName} ${s.employee.lastName}`,
          role: s.role?.name || null,
          startTime: s.startTime,
          endTime: s.endTime,
          status: s.status,
        })),
      })),
      summary: {
        totalShifts: schedule.shifts.length,
        totalHours: Math.round(totalHours * 100) / 100,
        totalLaborCost: Math.round(totalLaborCost * 100) / 100,
      },
    } })
  } catch (error) {
    console.error('Failed to fetch schedule:', error)
    return NextResponse.json({ error: 'Failed to fetch schedule' }, { status: 500 })
  }
}))

// PUT - Update schedule (publish, archive, etc.)
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, publishedBy, notes } = body as {
      action?: 'publish' | 'archive' | 'draft'
      publishedBy?: string
      notes?: string
    }

    const schedule = await db.schedule.findUnique({ where: { id } })
    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}

    if (notes !== undefined) {
      updateData.notes = notes
    }

    if (action === 'publish') {
      updateData.status = 'published'
      updateData.publishedAt = new Date()
      updateData.publishedBy = publishedBy
    } else if (action === 'archive') {
      updateData.status = 'archived'
    } else if (action === 'draft') {
      updateData.status = 'draft'
      updateData.publishedAt = null
      updateData.publishedBy = null
    }

    const updated = await db.schedule.update({
      where: { id },
      data: updateData,
    })

    void notifyDataChanged({ locationId: schedule.locationId, domain: 'scheduling', action: 'updated', entityId: id })
    void pushUpstream()
    void emitToLocation(schedule.locationId, 'schedules:changed', { trigger: 'schedule-updated' }).catch(err => log.warn({ err }, 'socket emit failed'))

    return NextResponse.json({ data: {
      schedule: {
        id: updated.id,
        weekStart: updated.weekStart.toISOString(),
        weekEnd: updated.weekEnd.toISOString(),
        status: updated.status,
        publishedAt: updated.publishedAt?.toISOString() || null,
        notes: updated.notes,
      },
    } })
  } catch (error) {
    console.error('Failed to update schedule:', error)
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 })
  }
}))

// DELETE - Delete schedule (only if draft)
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const schedule = await db.schedule.findUnique({ where: { id } })
    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    if (schedule.status !== 'draft') {
      return NextResponse.json(
        { error: 'Can only delete draft schedules' },
        { status: 400 }
      )
    }

    // Soft delete the schedule
    await db.schedule.update({ where: { id }, data: { deletedAt: new Date() } })

    void notifyDataChanged({ locationId: schedule.locationId, domain: 'scheduling', action: 'deleted', entityId: id })
    void pushUpstream()
    void emitToLocation(schedule.locationId, 'schedules:changed', { trigger: 'schedule-deleted' }).catch(err => log.warn({ err }, 'socket emit failed'))

    return NextResponse.json({ data: { message: 'Schedule deleted' } })
  } catch (error) {
    console.error('Failed to delete schedule:', error)
    return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 })
  }
}))
