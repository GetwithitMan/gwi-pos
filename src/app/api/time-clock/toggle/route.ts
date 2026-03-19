import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'
import { emitCloudEvent } from '@/lib/cloud-events'
import { parseSettings, DEFAULT_BREAK_COMPLIANCE } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { dispatchAlert } from '@/lib/alert-service'

// POST /api/time-clock/toggle - Single-call clock in/out toggle
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { employeeId, locationId, force } = body as {
      employeeId: string
      locationId: string
      force?: boolean
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

      // ── Break compliance check ──────────────────────────────────────────
      let breakComplianceWarning: string | null = null
      const locSettings = parseSettings(await getLocationSettings(locationId))
      const breakConfig = locSettings.breaks ?? DEFAULT_BREAK_COMPLIANCE
      if (breakConfig.complianceMode !== 'off') {
        const shiftHours = totalMinutes / 60
        if (shiftHours >= breakConfig.minShiftForBreak) {
          // Check break records and inline breakMinutes
          const breakRecords = await db.break.findMany({
            where: {
              timeClockEntryId: activeEntry.id,
              status: 'completed',
              deletedAt: null,
            },
            select: { duration: true },
          })
          const totalBreakMinutes = breakRecords.reduce((sum, b) => sum + (b.duration || 0), 0)
            || (activeEntry.breakMinutes || 0)
          const hasAdequateBreak = totalBreakMinutes >= breakConfig.breakDurationMinutes

          if (!hasAdequateBreak) {
            if (breakConfig.complianceMode === 'enforce') {
              return NextResponse.json(
                { error: 'Cannot clock out without taking a required break. Please clock in for break first.' },
                { status: 400 }
              )
            }
            // mode === 'warn'
            breakComplianceWarning = `Break compliance: No break taken during a ${Math.round(shiftHours * 10) / 10}-hour shift`
          }
        }
      }
      // ── End break compliance check ──────────────────────────────────────

      // ── requireTipsAdjusted check ──────────────────────────────────────
      if (!force && locSettings.clockOut?.requireTipsAdjusted) {
        const unadjustedTips = await db.payment.findMany({
          where: {
            order: { employeeId, locationId },
            paymentMethod: { in: ['credit', 'debit', 'card'] },
            tipAmount: { equals: 0 },
            datacapRecordNo: { not: null },
            status: 'completed',
            deletedAt: null,
            processedAt: { gte: activeEntry.clockIn },
          },
          select: { id: true, amount: true },
        })

        if (unadjustedTips.length > 0) {
          const totalUnadjusted = unadjustedTips.reduce((sum, p) => sum + Number(p.amount), 0)
          return NextResponse.json({
            data: {
              action: 'clock_out',
              clockedIn: true,
              warning: `You have ${unadjustedTips.length} unadjusted tip${unadjustedTips.length > 1 ? 's' : ''} totaling $${totalUnadjusted.toFixed(2)}. Please adjust tips before clocking out.`,
              unadjustedTipCount: unadjustedTips.length,
              unadjustedTipTotal: totalUnadjusted,
            },
          })
        }
      }
      // ── End requireTipsAdjusted check ──────────────────────────────────

      const otThreshold = breakConfig.overtimeThresholdHours ?? 8
      const regularHours = Math.min(workedHours, otThreshold)
      const overtimeHours = Math.max(0, workedHours - otThreshold)

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

      // Overtime alert dispatch (fire-and-forget)
      if (overtimeHours > 0) {
        void (async () => {
          try {
            if (!locSettings.alerts.enabled) return
            void dispatchAlert({
              severity: 'MEDIUM',
              errorType: 'overtime_detected',
              category: 'labor',
              message: `Overtime: ${employeeName} worked ${workedHours.toFixed(1)}h (${overtimeHours.toFixed(1)}h OT)`,
              locationId,
              employeeId,
              groupId: `overtime-${locationId}-${employeeId}-${activeEntry.id}`,
            }).catch(console.error)
          } catch (err) {
            console.error('[time-clock-toggle] Overtime alert dispatch failed:', err)
          }
        })()
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
          ...(breakComplianceWarning ? { warning: breakComplianceWarning } : {}),
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
