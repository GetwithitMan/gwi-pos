import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'
import { emitCloudEvent } from '@/lib/cloud-events'
import { withVenue } from '@/lib/with-venue'

// POST /api/time-clock/toggle - Single-call clock in/out toggle
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { employeeId, locationId } = body as {
      employeeId: string
      locationId: string
    }

    if (!employeeId || !locationId) {
      return NextResponse.json(
        { error: 'employeeId and locationId are required' },
        { status: 400 }
      )
    }

    // Check current clock status
    const activeEntry = await db.timeClockEntry.findFirst({
      where: {
        employeeId,
        clockOut: null,
        deletedAt: null,
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    })

    if (!activeEntry) {
      // ── Clock IN ──────────────────────────────────────────────────────────
      const entry = await db.timeClockEntry.create({
        data: {
          locationId,
          employeeId,
          clockIn: new Date(),
        },
        include: {
          employee: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      })

      const employeeName = entry.employee.displayName || `${entry.employee.firstName} ${entry.employee.lastName}`

      // Fire-and-forget side effects
      void emitToLocation(locationId, 'employee:clock-changed', { employeeId }).catch(() => {})
      void emitCloudEvent('time_clock', {
        employeeId,
        entryId: entry.id,
        action: 'clock_in',
        clockTime: entry.clockIn.toISOString(),
      }).catch(console.error)

      return NextResponse.json({
        data: {
          action: 'clock_in',
          clockedIn: true,
          entryId: entry.id,
          clockInTime: entry.clockIn.toISOString(),
          clockOutTime: null,
          employeeName,
          message: 'Clocked in successfully',
        },
      })
    } else {
      // ── Clock OUT ─────────────────────────────────────────────────────────
      const now = new Date()
      const clockInTime = activeEntry.clockIn.getTime()
      const totalMinutes = (now.getTime() - clockInTime) / (1000 * 60)
      const workedMinutes = totalMinutes - (activeEntry.breakMinutes || 0)
      const workedHours = workedMinutes / 60

      const regularHours = Math.min(workedHours, 8)
      const overtimeHours = Math.max(0, workedHours - 8)

      const updateData: Record<string, unknown> = {
        clockOut: now,
        regularHours: Math.round(regularHours * 100) / 100,
        overtimeHours: Math.round(overtimeHours * 100) / 100,
      }

      // End break if on break
      if (activeEntry.breakStart && !activeEntry.breakEnd) {
        const breakMinutes = Math.round((now.getTime() - activeEntry.breakStart.getTime()) / (1000 * 60))
        updateData.breakEnd = now
        updateData.breakMinutes = (activeEntry.breakMinutes || 0) + breakMinutes
      }

      const updated = await db.timeClockEntry.update({
        where: { id: activeEntry.id },
        data: updateData,
        include: {
          employee: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      })

      const employeeName = updated.employee.displayName || `${updated.employee.firstName} ${updated.employee.lastName}`

      // Fire-and-forget side effects
      void emitToLocation(locationId, 'employee:clock-changed', { employeeId }).catch(() => {})
      void emitCloudEvent('time_clock', {
        employeeId,
        entryId: activeEntry.id,
        action: 'clock_out',
        clockTime: now.toISOString(),
        regularHours: updated.regularHours ? Number(updated.regularHours) : 0,
        overtimeHours: updated.overtimeHours ? Number(updated.overtimeHours) : 0,
      }).catch(console.error)

      // Close any open Break records (fire-and-forget)
      if (activeEntry.breakStart) {
        const breakDuration = Math.round((now.getTime() - activeEntry.breakStart.getTime()) / (1000 * 60))
        void db.break.updateMany({
          where: {
            timeClockEntryId: activeEntry.id,
            endedAt: null,
            status: 'active',
          },
          data: {
            endedAt: now,
            duration: breakDuration,
            status: 'completed',
          },
        }).catch(err => console.error('Failed to close Break audit record:', err))
      }

      return NextResponse.json({
        data: {
          action: 'clock_out',
          clockedIn: false,
          entryId: updated.id,
          clockInTime: updated.clockIn.toISOString(),
          clockOutTime: updated.clockOut?.toISOString() || null,
          employeeName,
          message: 'Clocked out successfully',
        },
      })
    }
  } catch (error) {
    console.error('Failed to toggle clock:', error)
    return NextResponse.json(
      { error: 'Failed to toggle clock' },
      { status: 500 }
    )
  }
})
