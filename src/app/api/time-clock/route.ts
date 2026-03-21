import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { assignEmployeeToTemplateGroup } from '@/lib/domain/tips/tip-group-templates'
import { emitToLocation } from '@/lib/socket-server'
import { emitCloudEvent } from '@/lib/cloud-events'
import { dispatchLocationAlert } from '@/lib/socket-dispatch'
import { parseSettings, DEFAULT_BREAK_COMPLIANCE } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { findLastMemberGroup } from '@/lib/domain/tips/tip-groups'
import { dispatchAlert } from '@/lib/alert-service'
import { queueIfOutage, pushUpstream } from '@/lib/sync/outage-safe-write'

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

    // Auth check — require pos.access permission (any employee can clock in)
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

    // 60-second cooldown: prevent instant clock-out/clock-in cycling
    const lastClockOut = await db.timeClockEntry.findFirst({
      where: {
        employeeId,
        clockOut: { not: null },
      },
      orderBy: { clockOut: 'desc' },
      select: { clockOut: true },
    })

    if (lastClockOut?.clockOut) {
      const secondsSinceClockOut = (Date.now() - lastClockOut.clockOut.getTime()) / 1000
      if (secondsSinceClockOut < 60) {
        const waitSeconds = Math.ceil(60 - secondsSinceClockOut)
        return NextResponse.json(
          { error: `Please wait ${waitSeconds} seconds before clocking back in` },
          { status: 400 }
        )
      }
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

    // Queue for Neon replay if in outage mode (fire-and-forget)
    queueIfOutage('TimeClockEntry', locationId, entry.id, 'INSERT', entry as unknown as Record<string, unknown>)
    pushUpstream()

    // Fire-and-forget socket dispatch for real-time clock updates
    void emitToLocation(locationId, 'employee:clock-changed', { employeeId }).catch(() => {})

    // Emit cloud event for clock-in (fire-and-forget)
    void emitCloudEvent("time_clock", {
      employeeId,
      entryId: entry.id,
      action: "clock_in",
      clockTime: entry.clockIn.toISOString(),
    }).catch(console.error)

    // W5-10: Device/IP logging for buddy-punch prevention (fire-and-forget)
    const clockInIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const clockInUa = request.headers.get('user-agent') || 'unknown'
    void db.auditLog.create({
      data: {
        locationId,
        employeeId,
        action: 'clock_in',
        entityType: 'time_clock',
        entityId: entry.id,
        details: {
          ipAddress: clockInIp,
          userAgent: clockInUa,
          deviceFingerprint: `${clockInIp}|${clockInUa}`,
        },
      },
    }).catch(console.error)

    // W5-10: Buddy-punch detection — check for recent clock events from different IP
    void (async () => {
      try {
        const settings = parseSettings(await getLocationSettings(locationId))
        if (!settings.security.enableBuddyPunchDetection) return

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
        const recentAuditLogs = await db.auditLog.findMany({
          where: {
            locationId,
            employeeId,
            action: { in: ['clock_in', 'clock_out'] },
            entityType: 'time_clock',
            createdAt: { gte: oneHourAgo },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })

        const previousIps = recentAuditLogs
          .filter(log => {
            const details = log.details as Record<string, unknown> | null
            return details?.ipAddress && details.ipAddress !== clockInIp && details.ipAddress !== 'unknown'
          })
          .map(log => (log.details as Record<string, unknown>).ipAddress as string)

        if (previousIps.length > 0) {
          const empName = entry.employee.displayName || `${entry.employee.firstName} ${entry.employee.lastName}`
          void dispatchLocationAlert(locationId, {
            type: 'warning',
            title: 'Buddy Punch Warning',
            message: `${empName} clocked in from ${clockInIp}, previous event from ${previousIps[0]}`,
            dismissable: true,
          }, { async: true })

          void db.auditLog.create({
            data: {
              locationId,
              employeeId,
              action: 'alert_buddy_punch_warning',
              entityType: 'alert',
              entityId: entry.id,
              details: {
                alertType: 'warning',
                title: 'Buddy Punch Warning',
                currentIp: clockInIp,
                previousIp: previousIps[0],
                employeeName: empName,
              },
            },
          }).catch(console.error)
        }
      } catch (err) {
        console.error('[time-clock] Buddy-punch detection failed:', err)
      }
    })()

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
    const { entryId, action, notes, force, overrideClockOut: overrideClockOutRaw } = body as {
      entryId: string
      action: 'clockOut' | 'startBreak' | 'endBreak'
      notes?: string
      force?: boolean    // manager override for last-member block
      overrideClockOut?: string // ISO timestamp for retroactive clock-out (manager only)
    }
    const overrideClockOut = overrideClockOutRaw ? new Date(overrideClockOutRaw) : null

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
    let breakComplianceWarning: string | null = null

    switch (action) {
      case 'clockOut': {
        // ── Last-member group closeout guard ─────────────────────────────────
        // If this employee is the sole active member of any tip group,
        // block the clock-out so they are forced to close the group first.
        // A manager may pass force:true to override (audit-logged).
        if (!force) {
          const lastMemberGroup = await findLastMemberGroup(entry.employeeId, entry.locationId)
          if (lastMemberGroup) {
            return NextResponse.json(
              {
                error: 'You are the last member of your tip group. Close the group before clocking out.',
                errorCode: 'last_group_member',
                groupId: lastMemberGroup.groupId,
              },
              { status: 409 }
            )
          }
        } else {
          // Manager override path — log for audit trail (fire-and-forget)
          void db.auditLog.create({
            data: {
              locationId: entry.locationId,
              employeeId: entry.employeeId,
              action: 'clock_out_last_member_override',
              entityType: 'time_clock',
              entityId: entryId,
              details: { reason: 'Manager forced clock-out while last active tip group member' },
            },
          }).catch(console.error)
        }
        // ── End last-member guard ─────────────────────────────────────────────

        // ── Retroactive clock-out override (manager only) ───────────────────
        let effectiveClockOutTime = now
        if (overrideClockOut) {
          // Require STAFF_EDIT_WAGES permission for retroactive clock-out
          const requestingEmployeeId = request.headers.get('x-employee-id')
          const overrideAuth = await requirePermission(requestingEmployeeId, entry.locationId, PERMISSIONS.STAFF_EDIT_WAGES)
          if (!overrideAuth.authorized) {
            return NextResponse.json({ error: overrideAuth.error }, { status: overrideAuth.status })
          }

          // Validate: must be in the past
          if (overrideClockOut.getTime() > Date.now()) {
            return NextResponse.json(
              { error: 'Override clock-out time must be in the past' },
              { status: 400 }
            )
          }

          // Validate: must be after clock-in
          if (overrideClockOut.getTime() <= entry.clockIn.getTime()) {
            return NextResponse.json(
              { error: 'Override clock-out time must be after clock-in time' },
              { status: 400 }
            )
          }

          effectiveClockOutTime = overrideClockOut

          // Audit log for retroactive override (fire-and-forget)
          void db.auditLog.create({
            data: {
              locationId: entry.locationId,
              employeeId: requestingEmployeeId || entry.employeeId,
              action: 'clock_out_retroactive_override',
              entityType: 'time_clock',
              entityId: entryId,
              details: {
                originalClockOut: now.toISOString(),
                overrideClockOut: overrideClockOut.toISOString(),
                targetEmployeeId: entry.employeeId,
              },
            },
          }).catch(console.error)
        }
        // ── End retroactive clock-out override ──────────────────────────────

        // Calculate hours worked
        const clockInTime = entry.clockIn.getTime()
        const totalMinutes = (effectiveClockOutTime.getTime() - clockInTime) / (1000 * 60)
        const workedMinutes = totalMinutes - (entry.breakMinutes || 0)
        const workedHours = workedMinutes / 60

        // ── Break compliance check ──────────────────────────────────────────
        const locSettings = parseSettings(await getLocationSettings(entry.locationId))
        const breakConfig = locSettings.breaks ?? DEFAULT_BREAK_COMPLIANCE
        if (breakConfig.complianceMode !== 'off') {
          const shiftHours = totalMinutes / 60
          if (shiftHours >= breakConfig.minShiftForBreak) {
            // Check if any completed break meets the minimum duration
            const breakRecords = await db.break.findMany({
              where: {
                timeClockEntryId: entryId,
                status: 'completed',
                deletedAt: null,
              },
              select: { duration: true },
            })
            // Also account for inline breakMinutes on the entry (legacy path)
            const totalBreakMinutes = breakRecords.reduce((sum, b) => sum + (b.duration || 0), 0)
              || (entry.breakMinutes || 0)
            const hasAdequateBreak = totalBreakMinutes >= breakConfig.breakDurationMinutes

            if (!hasAdequateBreak) {
              if (breakConfig.complianceMode === 'enforce' && !force) {
                return NextResponse.json(
                  { error: 'Cannot clock out without taking a required break. Please clock in for break first.' },
                  { status: 400 }
                )
              }
              // mode === 'warn': set flag to include warning in response
              breakComplianceWarning = `Break compliance: No break taken during a ${Math.round(shiftHours * 10) / 10}-hour shift`
            }
          }
        }
        // ── End break compliance check ──────────────────────────────────────

        // ── requireTipsAdjusted check ──────────────────────────────────────
        if (!force && locSettings.clockOut?.requireTipsAdjusted) {
          const unadjustedTips = await db.payment.findMany({
            where: {
              order: { employeeId: entry.employeeId, locationId: entry.locationId },
              paymentMethod: { in: ['credit', 'debit', 'card'] },
              tipAmount: { equals: 0 },
              datacapRecordNo: { not: null },
              status: 'completed',
              deletedAt: null,
              processedAt: { gte: entry.clockIn },
            },
            select: { id: true, amount: true },
          })

          if (unadjustedTips.length > 0) {
            const totalUnadjusted = unadjustedTips.reduce((sum, p) => sum + Number(p.amount), 0)
            return NextResponse.json({
              data: {
                id: entry.id,
                employeeId: entry.employeeId,
                warning: `You have ${unadjustedTips.length} unadjusted tip${unadjustedTips.length > 1 ? 's' : ''} totaling $${totalUnadjusted.toFixed(2)}. Please adjust tips before clocking out.`,
                unadjustedTipCount: unadjustedTips.length,
                unadjustedTipTotal: totalUnadjusted,
              },
            })
          }
        }
        // ── End requireTipsAdjusted check ──────────────────────────────────

        // Calculate regular vs overtime (configurable threshold, default 8 hours)
        const otThreshold = breakConfig.overtimeThresholdHours ?? 8
        const regularHours = Math.min(workedHours, otThreshold)
        const overtimeHours = Math.max(0, workedHours - otThreshold)

        updateData = {
          clockOut: effectiveClockOutTime,
          regularHours: Math.round(regularHours * 100) / 100,
          overtimeHours: Math.round(overtimeHours * 100) / 100,
          notes: notes || entry.notes,
        }

        // End break if on break
        if (entry.breakStart && !entry.breakEnd) {
          const breakMinutes = Math.round((effectiveClockOutTime.getTime() - entry.breakStart.getTime()) / (1000 * 60))
          updateData.breakEnd = effectiveClockOutTime
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

    // Queue for Neon replay if in outage mode (fire-and-forget)
    queueIfOutage('TimeClockEntry', entry.locationId, updated.id, 'UPDATE', updated as unknown as Record<string, unknown>)
    pushUpstream()

    // Fire-and-forget socket dispatch for real-time clock updates
    void emitToLocation(entry.locationId, 'employee:clock-changed', { employeeId: entry.employeeId }).catch(() => {})

    // W5-10: Device/IP logging for clock-out (fire-and-forget)
    if (action === 'clockOut') {
      const clockOutIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      const clockOutUa = request.headers.get('user-agent') || 'unknown'
      void db.auditLog.create({
        data: {
          locationId: entry.locationId,
          employeeId: entry.employeeId,
          action: 'clock_out',
          entityType: 'time_clock',
          entityId: entry.id,
          details: {
            ipAddress: clockOutIp,
            userAgent: clockOutUa,
            deviceFingerprint: `${clockOutIp}|${clockOutUa}`,
          },
        },
      }).catch(console.error)
    }

    // Emit cloud event for clock-out (fire-and-forget)
    if (action === 'clockOut' && updated.clockOut) {
      void emitCloudEvent("time_clock", {
        employeeId: entry.employeeId,
        entryId: entry.id,
        action: "clock_out",
        clockTime: updated.clockOut.toISOString(),
        regularHours: updated.regularHours ? Number(updated.regularHours) : 0,
        overtimeHours: updated.overtimeHours ? Number(updated.overtimeHours) : 0,
      }).catch(console.error)
    }

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

    // Overtime alert dispatch (fire-and-forget)
    if (action === 'clockOut' && updated.overtimeHours && Number(updated.overtimeHours) > 0) {
      const empName = updated.employee.displayName || `${updated.employee.firstName} ${updated.employee.lastName}`
      const totalWorkedHours = (Number(updated.regularHours) || 0) + Number(updated.overtimeHours)
      void (async () => {
        try {
          const alertSettings = parseSettings(await getLocationSettings(entry.locationId))
          if (!alertSettings.alerts.enabled) return
          void dispatchAlert({
            severity: 'MEDIUM',
            errorType: 'overtime_detected',
            category: 'labor',
            message: `Overtime: ${empName} worked ${totalWorkedHours.toFixed(1)}h (${Number(updated.overtimeHours).toFixed(1)}h OT)`,
            locationId: entry.locationId,
            employeeId: entry.employeeId,
            groupId: `overtime-${entry.locationId}-${entry.employeeId}-${entry.id}`,
          }).catch(console.error)
        } catch (err) {
          console.error('[time-clock] Overtime alert dispatch failed:', err)
        }
      })()
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
      ...(breakComplianceWarning ? { warning: breakComplianceWarning } : {}),
    } })
  } catch (error) {
    console.error('Failed to update time clock:', error)
    return NextResponse.json(
      { error: 'Failed to update time clock' },
      { status: 500 }
    )
  }
})

// I-6: PATCH - Manager edit of time punch (with audit log)
export const PATCH = withVenue(async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { entryId, clockIn, clockOut, breakMinutes, notes, performedBy, locationId } = body as {
      entryId: string
      clockIn?: string
      clockOut?: string
      breakMinutes?: number
      notes?: string
      performedBy: string // manager's employeeId
      locationId: string
    }

    if (!entryId || !performedBy || !locationId) {
      return NextResponse.json(
        { error: 'Entry ID, performedBy, and locationId are required' },
        { status: 400 }
      )
    }

    // Require manager permission to edit time punches
    const auth = await requirePermission(performedBy, locationId, PERMISSIONS.STAFF_EDIT_WAGES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Fetch original entry
    const original = await db.timeClockEntry.findUnique({
      where: { id: entryId },
    })

    if (!original) {
      return NextResponse.json({ error: 'Time clock entry not found' }, { status: 404 })
    }

    // Capture before values
    const beforeValues = {
      clockIn: original.clockIn.toISOString(),
      clockOut: original.clockOut?.toISOString() || null,
      breakMinutes: original.breakMinutes,
    }

    // Build update
    const updateData: Record<string, unknown> = {}
    if (clockIn) updateData.clockIn = new Date(clockIn)
    if (clockOut) updateData.clockOut = new Date(clockOut)
    if (breakMinutes !== undefined) updateData.breakMinutes = breakMinutes
    if (notes !== undefined) updateData.notes = notes

    // Recalculate hours if clock times changed
    const effectiveClockIn = clockIn ? new Date(clockIn) : original.clockIn
    const effectiveClockOut = clockOut ? new Date(clockOut) : original.clockOut
    if (effectiveClockOut) {
      const totalMinutes = (effectiveClockOut.getTime() - effectiveClockIn.getTime()) / (1000 * 60)
      const effectiveBreak = breakMinutes !== undefined ? breakMinutes : (original.breakMinutes || 0)
      const workedHours = (totalMinutes - effectiveBreak) / 60
      const patchLocSettings = parseSettings(await getLocationSettings(original.locationId))
      const patchBreakConfig = patchLocSettings.breaks ?? DEFAULT_BREAK_COMPLIANCE
      const patchOtThreshold = patchBreakConfig.overtimeThresholdHours ?? 8
      updateData.regularHours = Math.round(Math.min(workedHours, patchOtThreshold) * 100) / 100
      updateData.overtimeHours = Math.round(Math.max(0, workedHours - patchOtThreshold) * 100) / 100
    }

    const updated = await db.timeClockEntry.update({
      where: { id: entryId },
      data: updateData,
    })

    // Queue for Neon replay if in outage mode (fire-and-forget)
    queueIfOutage('TimeClockEntry', original.locationId, updated.id, 'UPDATE', updated as unknown as Record<string, unknown>)
    pushUpstream()

    // Capture after values
    const afterValues = {
      clockIn: updated.clockIn.toISOString(),
      clockOut: updated.clockOut?.toISOString() || null,
      breakMinutes: updated.breakMinutes,
    }

    // Write audit log entry
    await db.auditLog.create({
      data: {
        locationId: original.locationId,
        employeeId: performedBy,
        action: 'TIME_PUNCH_EDIT',
        entityType: 'time_clock',
        entityId: entryId,
        details: {
          before: beforeValues,
          after: afterValues,
          editedEmployeeId: original.employeeId,
        },
      },
    })

    // Notify real-time
    void emitToLocation(original.locationId, 'employee:clock-changed', {
      employeeId: original.employeeId,
    }).catch(() => {})

    return NextResponse.json({ data: {
      id: updated.id,
      message: 'Time punch updated successfully',
      before: beforeValues,
      after: afterValues,
    } })
  } catch (error) {
    console.error('Failed to edit time punch:', error)
    return NextResponse.json(
      { error: 'Failed to edit time punch' },
      { status: 500 }
    )
  }
})
