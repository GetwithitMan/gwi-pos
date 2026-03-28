import { NextRequest } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { createReceipt } from '@/lib/7shifts-client'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { getBusinessDate, getDateRange, updateSyncStatus } from '../_helpers'
import { err, notFound, ok } from '@/lib/api-response'

export const POST = withVenue(async function POST(request: NextRequest) {
  const location = await db.location.findFirst({
    where: { deletedAt: null },
    select: { id: true, timezone: true, settings: true },
  })
  if (!location) return notFound('No location')

  const body = await request.json().catch(() => ({})) as { businessDate?: string; employeeId?: string }
  const actor = await getActorFromRequest(request)
  const resolvedEmployeeId = actor.employeeId ?? body.employeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_INTEGRATIONS)
  if (!auth.authorized) {
    return err(auth.error, auth.status)
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const s = settings.sevenShifts
  if (!s?.enabled || !s.clientId || !s.companyId) {
    return err('7shifts not configured')
  }

  const businessDate = body.businessDate || getBusinessDate(location.timezone || 'America/New_York')
  const { start, end } = getDateRange(businessDate, location.timezone || 'America/New_York')

  try {
    // Check for existing successful push
    const existing = await db.sevenShiftsDailySalesPush.findUnique({
      where: { locationId_businessDate_revenueType: { locationId: location.id, businessDate, revenueType: 'combined' } },
    })
    if (existing?.status === 'pushed') {
      return ok({ skipped: true, message: `Sales for ${businessDate} already pushed`, receiptId: existing.sevenShiftsReceiptId })
    }

    // Aggregate closed orders for the business date
    const orders = await db.order.findMany({
      where: {
        locationId: location.id,
        status: 'closed',
        closedAt: { gte: start, lt: end },
        deletedAt: null,
      },
      select: { id: true, total: true },
    })

    const orderIds = orders.map(o => o.id)
    const netTotalCents = orders.reduce((sum, o) => sum + Math.round(Number(o.total) * 100), 0)

    // Sum tips from payments on those orders
    let tipsAmountCents = 0
    if (orderIds.length > 0) {
      const tipAgg = await db.payment.aggregate({
        where: { orderId: { in: orderIds }, deletedAt: null },
        _sum: { tipAmount: true },
      })
      tipsAmountCents = Math.round(Number(tipAgg._sum.tipAmount ?? 0) * 100)
    }

    // Upsert push record
    const pushRecord = await db.sevenShiftsDailySalesPush.upsert({
      where: { locationId_businessDate_revenueType: { locationId: location.id, businessDate, revenueType: 'combined' } },
      create: {
        locationId: location.id,
        businessDate,
        revenueType: 'combined',
        netTotalCents,
        tipsAmountCents,
        status: 'pending',
      },
      update: {
        netTotalCents,
        tipsAmountCents,
        status: 'pending',
        errorMessage: null,
      },
    })

    // Push to 7shifts
    const result = await createReceipt(s, location.id, {
      receipt_id: pushRecord.id,
      location_id: s.locationId7s,
      receipt_date: new Date(`${businessDate}T00:00:00Z`).toISOString(),
      net_total: netTotalCents,
      tips: tipsAmountCents,
      status: 'closed',
    })

    // Mark success
    await db.sevenShiftsDailySalesPush.update({
      where: { id: pushRecord.id },
      data: {
        status: 'pushed',
        sevenShiftsReceiptId: String(result.receipt_id ?? result.id),
        pushedAt: new Date(),
      },
    })

    await updateSyncStatus(location.id, {
      lastSalesPushAt: new Date().toISOString(),
      lastSalesPushStatus: 'success',
      lastSalesPushError: null,
    })

    return ok({
        pushed: true,
        businessDate,
        orderCount: orders.length,
        netTotalCents,
        tipsAmountCents,
        receiptId: result.receipt_id ?? result.id,
      })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[7shifts/push-sales] Error:', message)

    await updateSyncStatus(location.id, {
      lastSalesPushAt: new Date().toISOString(),
      lastSalesPushStatus: 'error',
      lastSalesPushError: message.slice(0, 500),
    })

    return err('Failed to push sales to 7shifts', 502)
  }
})
