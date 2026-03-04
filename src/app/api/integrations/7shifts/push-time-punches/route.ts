import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { createTimePunch } from '@/lib/7shifts-client'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { getBusinessDate, getDateRange, updateSyncStatus } from '../_helpers'

export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({
    where: { deletedAt: null },
    select: { id: true, timezone: true, settings: true },
  })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  const body = await request.json().catch(() => ({})) as { businessDate?: string; employeeId?: string }
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
  const businessDate = body.businessDate || getBusinessDate(tz)
  const { start, end } = getDateRange(businessDate, tz)

  let pushed = 0
  let skipped = 0
  let failed = 0

  try {
    // Find completed time clock entries not yet pushed
    const entries = await db.timeClockEntry.findMany({
      where: {
        locationId: location.id,
        clockOut: { not: null },
        sevenShiftsTimePunchId: null,
        clockIn: { gte: start, lt: end },
        deletedAt: null,
      },
      include: {
        employee: {
          select: {
            id: true,
            sevenShiftsUserId: true,
            sevenShiftsRoleId: true,
            sevenShiftsDepartmentId: true,
          },
        },
      },
    })

    for (const entry of entries) {
      if (!entry.employee.sevenShiftsUserId) {
        skipped++
        continue
      }

      try {
        const result = await createTimePunch(s, location.id, {
          user_id: Number(entry.employee.sevenShiftsUserId),
          location_id: s.locationId7s,
          role_id: entry.employee.sevenShiftsRoleId ? Number(entry.employee.sevenShiftsRoleId) : undefined,
          department_id: entry.employee.sevenShiftsDepartmentId ? Number(entry.employee.sevenShiftsDepartmentId) : undefined,
          clocked_in: entry.clockIn.toISOString(),
          clocked_out: entry.clockOut!.toISOString(),
          break_minutes: entry.breakMinutes || undefined,
        })

        await db.timeClockEntry.update({
          where: { id: entry.id },
          data: {
            sevenShiftsTimePunchId: String(result.id),
            sevenShiftsPushedAt: new Date(),
            sevenShiftsPushError: null,
          },
        })
        pushed++
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[7shifts/push-time-punches] Entry ${entry.id} failed:`, message)
        await db.timeClockEntry.update({
          where: { id: entry.id },
          data: { sevenShiftsPushError: message.slice(0, 500) },
        })
        failed++
      }
    }

    const status = failed > 0 ? 'error' : 'success'
    await updateSyncStatus(location.id, {
      lastPunchPushAt: new Date().toISOString(),
      lastPunchPushStatus: status,
      lastPunchPushError: failed > 0 ? `${failed} punch(es) failed` : null,
    })

    return NextResponse.json({ data: { pushed, skipped, failed } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[7shifts/push-time-punches] Error:', message)

    await updateSyncStatus(location.id, {
      lastPunchPushAt: new Date().toISOString(),
      lastPunchPushStatus: 'error',
      lastPunchPushError: message.slice(0, 500),
    })

    return NextResponse.json({ error: 'Failed to push time punches' }, { status: 502 })
  }
})
