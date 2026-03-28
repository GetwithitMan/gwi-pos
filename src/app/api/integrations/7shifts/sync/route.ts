import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { createReceipt, createTimePunch, listShifts } from '@/lib/7shifts-client'
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
  const results: Record<string, unknown> = {}

  // 1. Push sales
  if (s.syncOptions.pushSales) {
    try {
      const { start, end } = getDateRange(businessDate, tz)
      const existing = await db.sevenShiftsDailySalesPush.findUnique({
        where: { locationId_businessDate_revenueType: { locationId: location.id, businessDate, revenueType: 'combined' } },
      })

      if (existing?.status === 'pushed') {
        results.sales = { skipped: true }
      } else {
        const orders = await db.order.findMany({
          where: { locationId: location.id, status: 'closed', closedAt: { gte: start, lt: end }, deletedAt: null },
          select: { id: true, total: true },
        })
        const orderIds = orders.map(o => o.id)
        const netTotalCents = orders.reduce((sum, o) => sum + Math.round(Number(o.total) * 100), 0)

        let tipsAmountCents = 0
        if (orderIds.length > 0) {
          const tipAgg = await db.payment.aggregate({
            where: { orderId: { in: orderIds }, deletedAt: null },
            _sum: { tipAmount: true },
          })
          tipsAmountCents = Math.round(Number(tipAgg._sum.tipAmount ?? 0) * 100)
        }

        const pushRecord = await db.sevenShiftsDailySalesPush.upsert({
          where: { locationId_businessDate_revenueType: { locationId: location.id, businessDate, revenueType: 'combined' } },
          create: { locationId: location.id, businessDate, revenueType: 'combined', netTotalCents, tipsAmountCents, status: 'pending' },
          update: { netTotalCents, tipsAmountCents, status: 'pending', errorMessage: null },
        })

        const receipt = await createReceipt(s, location.id, {
          receipt_id: pushRecord.id,
          location_id: s.locationId7s,
          receipt_date: new Date(`${businessDate}T00:00:00Z`).toISOString(),
          net_total: netTotalCents,
          tips: tipsAmountCents,
          status: 'closed',
        })

        await db.sevenShiftsDailySalesPush.update({
          where: { id: pushRecord.id },
          data: { status: 'pushed', sevenShiftsReceiptId: String(receipt.receipt_id ?? receipt.id), pushedAt: new Date() },
        })

        results.sales = { pushed: true, orderCount: orders.length, netTotalCents, tipsAmountCents }
      }

      await updateSyncStatus(location.id, {
        lastSalesPushAt: new Date().toISOString(),
        lastSalesPushStatus: 'success',
        lastSalesPushError: null,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown'
      results.sales = { error: msg.slice(0, 200) }
      await updateSyncStatus(location.id, {
        lastSalesPushAt: new Date().toISOString(),
        lastSalesPushStatus: 'error',
        lastSalesPushError: msg.slice(0, 500),
      })
    }
  }

  // 2. Push time punches
  if (s.syncOptions.pushTimePunches) {
    let pushed = 0, skippedPunches = 0, failedPunches = 0
    try {
      const { start, end } = getDateRange(businessDate, tz)
      const entries = await db.timeClockEntry.findMany({
        where: {
          locationId: location.id,
          clockOut: { not: null },
          sevenShiftsTimePunchId: null,
          clockIn: { gte: start, lt: end },
          deletedAt: null,
        },
        include: { employee: { select: { id: true, sevenShiftsUserId: true, sevenShiftsRoleId: true, sevenShiftsDepartmentId: true } } },
      })

      for (const entry of entries) {
        if (!entry.employee.sevenShiftsUserId) { skippedPunches++; continue }
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
            data: { sevenShiftsTimePunchId: String(result.id), sevenShiftsPushedAt: new Date(), sevenShiftsPushError: null },
          })
          pushed++
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown'
          await db.timeClockEntry.update({ where: { id: entry.id }, data: { sevenShiftsPushError: msg.slice(0, 500) } })
          failedPunches++
        }
      }

      results.punches = { pushed, skipped: skippedPunches, failed: failedPunches }
      await updateSyncStatus(location.id, {
        lastPunchPushAt: new Date().toISOString(),
        lastPunchPushStatus: failedPunches > 0 ? 'error' : 'success',
        lastPunchPushError: failedPunches > 0 ? `${failedPunches} failed` : null,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown'
      results.punches = { error: msg.slice(0, 200) }
      await updateSyncStatus(location.id, {
        lastPunchPushAt: new Date().toISOString(),
        lastPunchPushStatus: 'error',
        lastPunchPushError: msg.slice(0, 500),
      })
    }
  }

  // 3. Pull schedule
  if (s.syncOptions.pullSchedule) {
    let upserted = 0, deletedShifts = 0, skippedShifts = 0
    try {
      const startDate = getBusinessDate(tz, 0)
      const endDate = getBusinessDate(tz, 14)
      const shifts = await listShifts(s, location.id, startDate, endDate)

      const schedule = await db.schedule.findFirst({
        where: { locationId: location.id, deletedAt: null },
        select: { id: true },
        orderBy: { weekStart: 'desc' },
      })

      if (!schedule) {
        results.schedule = { error: 'No schedule exists', skipped: shifts.length }
      } else {
        // Pre-fetch all linked employees in one query to avoid N+1
        const linkedEmployees = await db.employee.findMany({
          where: { locationId: location.id, sevenShiftsUserId: { not: null }, deletedAt: null },
          select: { id: true, sevenShiftsUserId: true },
        })
        const employeeMap = new Map(linkedEmployees.map(e => [e.sevenShiftsUserId!, e]))

        for (const shift of shifts) {
          const employee = employeeMap.get(String(shift.user_id))
          if (!employee) { skippedShifts++; continue }

          const shiftDate = new Date(shift.start)
          const startTime = shift.start.slice(11, 16)
          const endTime = shift.end.slice(11, 16)

          if (shift.status === 'deleted') {
            const existing = await db.scheduledShift.findFirst({ where: { sevenShiftsShiftId: String(shift.id), deletedAt: null } })
            if (existing) {
              await db.scheduledShift.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
              deletedShifts++
            }
            continue
          }

          const existing = await db.scheduledShift.findFirst({ where: { sevenShiftsShiftId: String(shift.id) } })
          if (existing) {
            await db.scheduledShift.update({
              where: { id: existing.id },
              data: { date: shiftDate, startTime, endTime, breakMinutes: shift.break_minutes ?? 0, notes: shift.notes ?? existing.notes, deletedAt: null },
            })
          } else {
            await db.scheduledShift.create({
              data: {
                locationId: location.id, scheduleId: schedule.id, employeeId: employee.id,
                date: shiftDate, startTime, endTime, breakMinutes: shift.break_minutes ?? 0,
                notes: shift.notes ?? null, sevenShiftsShiftId: String(shift.id),
              },
            })
          }
          upserted++
        }
        results.schedule = { upserted, deleted: deletedShifts, skipped: skippedShifts }
      }

      await updateSyncStatus(location.id, {
        lastSchedulePullAt: new Date().toISOString(),
        lastSchedulePullStatus: 'success',
        lastSchedulePullError: null,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown'
      results.schedule = { error: msg.slice(0, 200) }
      await updateSyncStatus(location.id, {
        lastSchedulePullAt: new Date().toISOString(),
        lastSchedulePullStatus: 'error',
        lastSchedulePullError: msg.slice(0, 500),
      })
    }
  }

  return NextResponse.json({ data: { businessDate, ...results } })
})
