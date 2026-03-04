import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { createReceipt, createTimePunch, listShifts } from '@/lib/7shifts-client'

function getBusinessDate(timezone: string, daysOffset = -1): string {
  const target = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const parts = formatter.formatToParts(target)
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`
}

function getDateRange(businessDate: string, timezone: string): { start: Date; end: Date } {
  const [year, month, day] = businessDate.split('-').map(Number)
  const refDate = new Date(`${businessDate}T12:00:00Z`)
  const utcStr = refDate.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = refDate.toLocaleString('en-US', { timeZone: timezone })
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime()
  const start = new Date(Date.UTC(year, month - 1, day) + offsetMs)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

async function updateSyncStatus(locationId: string, updates: Record<string, unknown>): Promise<void> {
  try {
    const loc = await db.location.findUnique({ where: { id: locationId }, select: { settings: true } })
    if (!loc) return
    const parsed = parseSettings(loc.settings)
    await db.location.update({
      where: { id: locationId },
      data: { settings: { ...parsed, sevenShifts: { ...parsed.sevenShifts, ...updates } } as object },
    })
  } catch { /* non-fatal */ }
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const locations = await db.location.findMany({
    where: { deletedAt: null },
    select: { id: true, timezone: true, settings: true },
  })

  const results: Record<string, unknown> = {}

  for (const location of locations) {
    const settings = parseSettings(location.settings)
    const s = settings.sevenShifts
    if (!s?.enabled || !s.clientId || !s.companyId) continue

    const tz = location.timezone || 'America/New_York'
    const businessDate = getBusinessDate(tz)
    const locationResult: Record<string, unknown> = { businessDate }

    // Push sales
    if (s.syncOptions.pushSales) {
      try {
        const { start, end } = getDateRange(businessDate, tz)
        const existing = await db.sevenShiftsDailySalesPush.findUnique({
          where: { locationId_businessDate_revenueType: { locationId: location.id, businessDate, revenueType: 'combined' } },
        })

        if (existing?.status === 'pushed') {
          locationResult.sales = { skipped: true }
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
            receipt_id: pushRecord.id, location_id: s.locationId7s,
            receipt_date: new Date(`${businessDate}T00:00:00Z`).toISOString(),
            net_total: netTotalCents, tips: tipsAmountCents, status: 'closed',
          })

          await db.sevenShiftsDailySalesPush.update({
            where: { id: pushRecord.id },
            data: { status: 'pushed', sevenShiftsReceiptId: String(receipt.receipt_id ?? receipt.id), pushedAt: new Date() },
          })
          locationResult.sales = { pushed: true, orderCount: orders.length, netTotalCents }
        }
        await updateSyncStatus(location.id, { lastSalesPushAt: new Date().toISOString(), lastSalesPushStatus: 'success', lastSalesPushError: null })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown'
        locationResult.sales = { error: msg.slice(0, 200) }
        await updateSyncStatus(location.id, { lastSalesPushAt: new Date().toISOString(), lastSalesPushStatus: 'error', lastSalesPushError: msg.slice(0, 500) })
      }
    }

    // Push time punches
    if (s.syncOptions.pushTimePunches) {
      let pushed = 0, skippedP = 0, failedP = 0
      try {
        const { start, end } = getDateRange(businessDate, tz)
        const entries = await db.timeClockEntry.findMany({
          where: { locationId: location.id, clockOut: { not: null }, sevenShiftsTimePunchId: null, clockIn: { gte: start, lt: end }, deletedAt: null },
          include: { employee: { select: { id: true, sevenShiftsUserId: true, sevenShiftsRoleId: true, sevenShiftsDepartmentId: true } } },
        })

        for (const entry of entries) {
          if (!entry.employee.sevenShiftsUserId) { skippedP++; continue }
          try {
            const result = await createTimePunch(s, location.id, {
              user_id: Number(entry.employee.sevenShiftsUserId), location_id: s.locationId7s,
              role_id: entry.employee.sevenShiftsRoleId ? Number(entry.employee.sevenShiftsRoleId) : undefined,
              department_id: entry.employee.sevenShiftsDepartmentId ? Number(entry.employee.sevenShiftsDepartmentId) : undefined,
              clocked_in: entry.clockIn.toISOString(), clocked_out: entry.clockOut!.toISOString(),
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
            failedP++
          }
        }

        locationResult.punches = { pushed, skipped: skippedP, failed: failedP }
        await updateSyncStatus(location.id, {
          lastPunchPushAt: new Date().toISOString(),
          lastPunchPushStatus: failedP > 0 ? 'error' : 'success',
          lastPunchPushError: failedP > 0 ? `${failedP} failed` : null,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown'
        locationResult.punches = { error: msg.slice(0, 200) }
        await updateSyncStatus(location.id, { lastPunchPushAt: new Date().toISOString(), lastPunchPushStatus: 'error', lastPunchPushError: msg.slice(0, 500) })
      }
    }

    // Pull schedule
    if (s.syncOptions.pullSchedule) {
      let upserted = 0, deletedS = 0, skippedS = 0
      try {
        const startDate = getBusinessDate(tz, 0)
        const endDate = getBusinessDate(tz, 14)
        const shifts = await listShifts(s, location.id, startDate, endDate)

        const schedule = await db.schedule.findFirst({
          where: { locationId: location.id, deletedAt: null },
          select: { id: true }, orderBy: { weekStart: 'desc' },
        })

        if (!schedule) {
          locationResult.schedule = { error: 'No schedule exists', skipped: shifts.length }
        } else {
          for (const shift of shifts) {
            const employee = await db.employee.findFirst({
              where: { locationId: location.id, sevenShiftsUserId: String(shift.user_id), deletedAt: null },
              select: { id: true },
            })
            if (!employee) { skippedS++; continue }

            const shiftDate = new Date(shift.start)
            const startTime = shift.start.slice(11, 16)
            const endTime = shift.end.slice(11, 16)

            if (shift.status === 'deleted') {
              const ex = await db.scheduledShift.findFirst({ where: { sevenShiftsShiftId: String(shift.id), deletedAt: null } })
              if (ex) { await db.scheduledShift.update({ where: { id: ex.id }, data: { deletedAt: new Date() } }); deletedS++ }
              continue
            }

            const ex = await db.scheduledShift.findFirst({ where: { sevenShiftsShiftId: String(shift.id) } })
            if (ex) {
              await db.scheduledShift.update({
                where: { id: ex.id },
                data: { date: shiftDate, startTime, endTime, breakMinutes: shift.break_minutes ?? 0, notes: shift.notes ?? ex.notes, deletedAt: null },
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
          locationResult.schedule = { upserted, deleted: deletedS, skipped: skippedS }
        }
        await updateSyncStatus(location.id, { lastSchedulePullAt: new Date().toISOString(), lastSchedulePullStatus: 'success', lastSchedulePullError: null })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown'
        locationResult.schedule = { error: msg.slice(0, 200) }
        await updateSyncStatus(location.id, { lastSchedulePullAt: new Date().toISOString(), lastSchedulePullStatus: 'error', lastSchedulePullError: msg.slice(0, 500) })
      }
    }

    results[location.id] = locationResult
  }

  return NextResponse.json({ data: results })
}
