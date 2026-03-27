import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchTableStatusChanged } from '@/lib/socket-dispatch'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('orders-eod-cleanup')

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Auth check — require manager.close_day permission
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.MGR_CLOSE_DAY)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Resolve the current business day boundary using location settings (same as /api/eod/reset)
    const location = await db.location.findFirst({
      where: { id: locationId },
      select: { settings: true, timezone: true },
    })
    const locSettings = location?.settings as Record<string, unknown> | null
    const dayStartTime = (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct business day
    const venueTimezone = location?.timezone || 'America/New_York'
    const currentBusinessDayStart = getCurrentBusinessDay(dayStartTime, venueTimezone).start

    // Find stale orders: draft/open/in_progress, whose businessDayDate is before the current business day, not deleted
    // Read from OrderSnapshot (event-sourced projection) — cents-based fields
    // in_progress = partial payment started but never completed (stuck from previous day)
    const staleOrders = await db.orderSnapshot.findMany({
      where: {
        locationId,
        deletedAt: null,
        status: { in: ['draft', 'open', 'in_progress'] },
        OR: [
          { businessDayDate: { lt: currentBusinessDayStart } },
          { businessDayDate: null, createdAt: { lt: currentBusinessDayStart } },
        ],
      },
      select: {
        id: true,
        totalCents: true,
        paidAmountCents: true,
        tableId: true,
        itemCount: true,
        status: true,
      },
    })

    const toCancelIds: string[] = []
    const toResetTableIds: string[] = []
    const abandonedIds: string[] = []
    let rolledForward = 0

    for (const order of staleOrders) {
      // in_progress orders have partial payments — flag as abandoned, don't auto-cancel
      if (order.status === 'in_progress') {
        abandonedIds.push(order.id)
        if (order.tableId) {
          toResetTableIds.push(order.tableId)
        }
        continue
      }

      const hasBalance = order.totalCents > 0 && order.itemCount > 0
      if (hasBalance) {
        // Orders with a balance roll forward
        rolledForward++
      } else {
        // Empty or zero-total orders get cancelled
        toCancelIds.push(order.id)
        if (order.tableId) {
          toResetTableIds.push(order.tableId)
        }
      }
    }

    // Batch cancel stale orders
    if (toCancelIds.length > 0) {
      await db.order.updateMany({
        where: { id: { in: toCancelIds } },
        data: {
          status: 'cancelled',
          deletedAt: new Date(),
          lastMutatedBy: 'local',
        },
      })
    }

    // Flag in_progress orders as abandoned — they have partial payments and need manual resolution
    if (abandonedIds.length > 0) {
      await db.order.updateMany({
        where: { id: { in: abandonedIds } },
        data: {
          status: 'voided',
          closedAt: new Date(),
          notes: 'EOD cleanup: stuck in_progress order from previous business day — needs manual resolution (has partial payments)',
          lastMutatedBy: 'local',
        },
      })
      console.warn(`[EOD Cleanup] ${abandonedIds.length} in_progress order(s) marked as abandoned (partial payments need manual resolution): ${abandonedIds.join(', ')}`)
    }

    // Reset tables to available
    if (toResetTableIds.length > 0) {
      await db.table.updateMany({
        where: { id: { in: toResetTableIds } },
        data: { status: 'available' },
      })
      // Dispatch table:status-changed for each reset table
      for (const tableId of toResetTableIds) {
        void dispatchTableStatusChanged(locationId, { tableId, status: 'available' }).catch(err => log.warn({ err }, 'Background task failed'))
      }
    }

    // Emit ORDER_CLOSED events for each cancelled order (fire-and-forget)
    for (const id of toCancelIds) {
      void emitOrderEvent(locationId, id, 'ORDER_CLOSED', {
        closedStatus: 'cancelled',
        reason: 'EOD cleanup: stale empty order from previous business day',
      })
    }

    // Emit ORDER_CLOSED events for abandoned orders (fire-and-forget)
    for (const id of abandonedIds) {
      void emitOrderEvent(locationId, id, 'ORDER_CLOSED', {
        closedStatus: 'abandoned',
        reason: 'EOD cleanup: stuck in_progress order with partial payments from previous business day',
      })
    }

    // Fire socket events so all terminals update
    if (toCancelIds.length > 0 || abandonedIds.length > 0) {
      void dispatchOpenOrdersChanged(locationId, {
        trigger: 'voided',
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Refresh floor plan so table statuses update on other terminals
    if (toResetTableIds.length > 0) {
      void dispatchFloorPlanUpdate(locationId).catch(err => log.warn({ err }, 'Background task failed'))
    }

    if (toCancelIds.length > 0 || abandonedIds.length > 0 || toResetTableIds.length > 0) {
      pushUpstream()
    }

    return NextResponse.json({
      data: {
        cancelled: toCancelIds.length,
        abandoned: abandonedIds.length,
        rolledForward,
        cancelledOrderIds: toCancelIds,
        abandonedOrderIds: abandonedIds,
      },
    })
  } catch (error) {
    console.error('[EOD Cleanup] Error:', error)
    return NextResponse.json(
      { error: 'Failed to run EOD cleanup' },
      { status: 500 }
    )
  }
})
