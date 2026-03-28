import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { listShifts } from '@/lib/7shifts-client'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { getBusinessDate, updateSyncStatus } from '../_helpers'

export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({
    where: { deletedAt: null },
    select: { id: true, timezone: true, settings: true },
  })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  const body = await request.json().catch(() => ({})) as {
    startDate?: string
    endDate?: string
    employeeId?: string
  }
  const actor = await getActorFromRequest(request)
  const resolvedEmployeeId = actor.employeeId ?? body.employeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_INTEGRATIONS)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const s = settings.sevenShifts
  if (!s?.enabled || !s.clientId || !s.companyId) {
    return NextResponse.json({ error: '7shifts not configured' }, { status: 400 })
  }

  const tz = location.timezone || 'America/New_York'
  const startDate = body.startDate || getBusinessDate(tz, 0)
  const endDate = body.endDate || getBusinessDate(tz, 14)

  let upserted = 0
  let deleted = 0
  let skipped = 0

  try {
    const shifts = await listShifts(s, location.id, startDate, endDate)

    // We need a schedule to attach shifts to
    const schedule = await db.schedule.findFirst({
      where: { locationId: location.id, deletedAt: null },
      select: { id: true },
      orderBy: { weekStart: 'desc' },
    })

    if (!schedule) {
      console.warn('[7shifts/pull-schedule] No schedule found for location — skipping all shifts')
      await updateSyncStatus(location.id, {
        lastSchedulePullAt: new Date().toISOString(),
        lastSchedulePullStatus: 'error',
        lastSchedulePullError: 'No schedule exists for this location. Create a schedule first.',
      })
      return NextResponse.json({
        data: { upserted: 0, deleted: 0, skipped: shifts.length, error: 'No schedule exists' },
      })
    }

    // Pre-fetch all linked employees in one query to avoid N+1
    const linkedEmployees = await db.employee.findMany({
      where: { locationId: location.id, sevenShiftsUserId: { not: null }, deletedAt: null },
      select: { id: true, sevenShiftsUserId: true },
    })
    const employeeMap = new Map(linkedEmployees.map(e => [e.sevenShiftsUserId!, e]))

    for (const shift of shifts) {
      // Find linked employee via pre-fetched map
      const employee = employeeMap.get(String(shift.user_id))

      if (!employee) {
        skipped++
        continue
      }

      const shiftDate = new Date(shift.start)
      const startTime = shift.start.slice(11, 16) // HH:MM from ISO
      const endTime = shift.end.slice(11, 16)

      if (shift.status === 'deleted') {
        // Soft-delete matching scheduled shift
        const existing = await db.scheduledShift.findFirst({
          where: { sevenShiftsShiftId: String(shift.id), deletedAt: null },
        })
        if (existing) {
          await db.scheduledShift.update({
            where: { id: existing.id },
            data: { deletedAt: new Date() },
          })
          deleted++
        }
        continue
      }

      // Upsert by sevenShiftsShiftId
      const existing = await db.scheduledShift.findFirst({
        where: { sevenShiftsShiftId: String(shift.id) },
      })

      if (existing) {
        await db.scheduledShift.update({
          where: { id: existing.id },
          data: {
            date: shiftDate,
            startTime,
            endTime,
            breakMinutes: shift.break_minutes ?? 0,
            notes: shift.notes ?? existing.notes,
            deletedAt: null,
          },
        })
      } else {
        await db.scheduledShift.create({
          data: {
            locationId: location.id,
            scheduleId: schedule.id,
            employeeId: employee.id,
            date: shiftDate,
            startTime,
            endTime,
            breakMinutes: shift.break_minutes ?? 0,
            notes: shift.notes ?? null,
            sevenShiftsShiftId: String(shift.id),
          },
        })
      }
      upserted++
    }

    await updateSyncStatus(location.id, {
      lastSchedulePullAt: new Date().toISOString(),
      lastSchedulePullStatus: 'success',
      lastSchedulePullError: null,
    })

    return NextResponse.json({ data: { upserted, deleted, skipped } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[7shifts/pull-schedule] Error:', message)

    await updateSyncStatus(location.id, {
      lastSchedulePullAt: new Date().toISOString(),
      lastSchedulePullStatus: 'error',
      lastSchedulePullError: message.slice(0, 500),
    })

    return NextResponse.json({ error: 'Failed to pull schedule from 7shifts' }, { status: 502 })
  }
})
