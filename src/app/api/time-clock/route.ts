import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { assignEmployeeToTemplateGroup } from '@/lib/domain/tips/tip-group-templates'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'

// GET - List time clock entries
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const openOnly = searchParams.get('openOnly') === 'true'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Build filters
    const where: Record<string, unknown> = { locationId }

    if (employeeId) {
      where.employeeId = employeeId
    }

    if (openOnly) {
      where.clockOut = null
    }

    if (startDate || endDate) {
      where.clockIn = {}
      if (startDate) {
        (where.clockIn as Record<string, Date>).gte = new Date(startDate)
      }
      if (endDate) {
        (where.clockIn as Record<string, Date>).lte = new Date(endDate + 'T23:59:59')
      }
    }

    const entries = await db.timeClockEntry.findMany({
      where,
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
      },
      orderBy: { clockIn: 'desc' },
      take: 100,
    })

    return NextResponse.json({ data: {
      entries: entries.map(entry => ({
        id: entry.id,
        employeeId: entry.employeeId,
        employeeName: entry.employee.displayName || `${entry.employee.firstName} ${entry.employee.lastName}`,
        hourlyRate: entry.employee.hourlyRate ? Number(entry.employee.hourlyRate) : null,
        clockIn: entry.clockIn.toISOString(),
        clockOut: entry.clockOut?.toISOString() || null,
        breakMinutes: entry.breakMinutes,
        isOnBreak: entry.breakStart && !entry.breakEnd,
        regularHours: entry.regularHours ? Number(entry.regularHours) : null,
        overtimeHours: entry.overtimeHours ? Number(entry.overtimeHours) : null,
        notes: entry.notes,
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch time clock entries:', error)
    return NextResponse.json(
      { error: 'Failed to fetch time clock entries' },
      { status: 500 }
    )
  }
})

// POST - Clock in
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, notes, workingRoleId, selectedTipGroupTemplateId } = body as {
      locationId: string
      employeeId: string
      notes?: string
      workingRoleId?: string
      selectedTipGroupTemplateId?: string | null
    }

    if (!locationId || !employeeId) {
      return NextResponse.json(
        { error: 'Location ID and Employee ID are required' },
        { status: 400 }
      )
    }

    // Check if employee is already clocked in
    const existing = await db.timeClockEntry.findFirst({
      where: {
        employeeId,
        clockOut: null,
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Employee is already clocked in' },
        { status: 409 }
      )
    }

    const entry = await db.timeClockEntry.create({
      data: {
        locationId,
        employeeId,
        clockIn: new Date(),
        notes,
        ...(workingRoleId ? { workingRoleId } : {}),
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

    // Fire-and-forget socket dispatch for real-time clock updates
    void emitToLocation(locationId, 'employee:clock-changed', { employeeId }).catch(() => {})

    // If a tip group template was selected, assign the employee to its runtime group.
    // Wrapped in try/catch so clock-in still succeeds even if group assignment fails.
    let selectedTipGroup: { id: string; name: string } | null = null
    if (selectedTipGroupTemplateId) {
      try {
        const groupInfo = await assignEmployeeToTemplateGroup({
          employeeId,
          templateId: selectedTipGroupTemplateId,
          locationId,
        })

        // Update the TimeClockEntry with the actual runtime group ID
        await db.timeClockEntry.update({
          where: { id: entry.id },
          data: { selectedTipGroupId: groupInfo.id },
        })

        // Look up the template name for the response
        const template = await db.tipGroupTemplate.findFirst({
          where: { id: selectedTipGroupTemplateId },
          select: { name: true },
        })

        selectedTipGroup = { id: groupInfo.id, name: template?.name ?? 'Tip Group' }
      } catch (err) {
        console.warn('[time-clock] Tip group assignment failed (clock-in still succeeds):', err)
      }
    }

    return NextResponse.json({ data: {
      id: entry.id,
      employeeId: entry.employeeId,
      employeeName: entry.employee.displayName || `${entry.employee.firstName} ${entry.employee.lastName}`,
      clockIn: entry.clockIn.toISOString(),
      message: 'Clocked in successfully',
      ...(selectedTipGroup ? { selectedTipGroup } : {}),
    } })
  } catch (error) {
    console.error('Failed to clock in:', error)
    return NextResponse.json(
      { error: 'Failed to clock in' },
      { status: 500 }
    )
  }
})

// PUT - Clock out, start/end break
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { entryId, action, notes } = body as {
      entryId: string
      action: 'clockOut' | 'startBreak' | 'endBreak'
      notes?: string
    }

    if (!entryId || !action) {
      return NextResponse.json(
        { error: 'Entry ID and action are required' },
        { status: 400 }
      )
    }

    const entry = await db.timeClockEntry.findUnique({
      where: { id: entryId },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Time clock entry not found' },
        { status: 404 }
      )
    }

    if (entry.clockOut) {
      return NextResponse.json(
        { error: 'This entry is already closed' },
        { status: 400 }
      )
    }

    const now = new Date()
    let updateData: Record<string, unknown> = {}

    switch (action) {
      case 'clockOut': {
        // Calculate hours worked
        const clockInTime = entry.clockIn.getTime()
        const totalMinutes = (now.getTime() - clockInTime) / (1000 * 60)
        const workedMinutes = totalMinutes - (entry.breakMinutes || 0)
        const workedHours = workedMinutes / 60

        // Calculate regular vs overtime (over 8 hours)
        const regularHours = Math.min(workedHours, 8)
        const overtimeHours = Math.max(0, workedHours - 8)

        updateData = {
          clockOut: now,
          regularHours: Math.round(regularHours * 100) / 100,
          overtimeHours: Math.round(overtimeHours * 100) / 100,
          notes: notes || entry.notes,
        }

        // End break if on break
        if (entry.breakStart && !entry.breakEnd) {
          const breakMinutes = Math.round((now.getTime() - entry.breakStart.getTime()) / (1000 * 60))
          updateData.breakEnd = now
          updateData.breakMinutes = (entry.breakMinutes || 0) + breakMinutes
        }
        break
      }

      case 'startBreak': {
        if (entry.breakStart && !entry.breakEnd) {
          return NextResponse.json(
            { error: 'Already on break' },
            { status: 400 }
          )
        }
        updateData = {
          breakStart: now,
          breakEnd: null,
        }
        break
      }

      case 'endBreak': {
        if (!entry.breakStart || entry.breakEnd) {
          return NextResponse.json(
            { error: 'Not currently on break' },
            { status: 400 }
          )
        }
        const breakMinutes = Math.round((now.getTime() - entry.breakStart.getTime()) / (1000 * 60))
        updateData = {
          breakEnd: now,
          breakMinutes: (entry.breakMinutes || 0) + breakMinutes,
        }
        break
      }
    }

    const updated = await db.timeClockEntry.update({
      where: { id: entryId },
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

    // Fire-and-forget socket dispatch for real-time clock updates
    void emitToLocation(entry.locationId, 'employee:clock-changed', { employeeId: entry.employeeId }).catch(() => {})

    // Break audit trail: create/close Break records
    if (action === 'startBreak') {
      await db.break.create({
        data: {
          locationId: entry.locationId,
          employeeId: entry.employeeId,
          timeClockEntryId: entryId,
          startedAt: now,
          status: 'active',
        },
      }).catch(err => console.error('Failed to create Break audit record:', err))
    } else if (action === 'endBreak' || action === 'clockOut') {
      // Close any open Break records (endBreak closes current, clockOut catches auto-ended breaks)
      const breakDuration = entry.breakStart
        ? Math.round((now.getTime() - entry.breakStart.getTime()) / (1000 * 60))
        : 0
      await db.break.updateMany({
        where: {
          timeClockEntryId: entryId,
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

    return NextResponse.json({ data: {
      id: updated.id,
      employeeId: updated.employeeId,
      employeeName: updated.employee.displayName || `${updated.employee.firstName} ${updated.employee.lastName}`,
      clockIn: updated.clockIn.toISOString(),
      clockOut: updated.clockOut?.toISOString() || null,
      breakMinutes: updated.breakMinutes,
      isOnBreak: updated.breakStart && !updated.breakEnd,
      regularHours: updated.regularHours ? Number(updated.regularHours) : null,
      overtimeHours: updated.overtimeHours ? Number(updated.overtimeHours) : null,
      message: action === 'clockOut' ? 'Clocked out successfully' :
               action === 'startBreak' ? 'Break started' : 'Break ended',
    } })
  } catch (error) {
    console.error('Failed to update time clock:', error)
    return NextResponse.json(
      { error: 'Failed to update time clock' },
      { status: 500 }
    )
  }
})
