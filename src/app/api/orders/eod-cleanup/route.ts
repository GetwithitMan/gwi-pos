import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { emitOrderEvent } from '@/lib/order-events/emitter'

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
      select: { settings: true },
    })
    const locSettings = location?.settings as Record<string, unknown> | null
    const dayStartTime = (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const currentBusinessDayStart = getCurrentBusinessDay(dayStartTime).start

    // Find stale orders: draft/open, whose businessDayDate is before the current business day, not deleted
    // Read from OrderSnapshot (event-sourced projection) — cents-based fields
    const staleOrders = await db.orderSnapshot.findMany({
      where: {
        locationId,
        deletedAt: null,
        status: { in: ['draft', 'open'] },
        OR: [
          { businessDayDate: { lt: currentBusinessDayStart } },
          { businessDayDate: null, createdAt: { lt: currentBusinessDayStart } },
        ],
      },
      select: {
        id: true,
        totalCents: true,
        tableId: true,
        itemCount: true,
      },
    })

    const toCancelIds: string[] = []
    const toResetTableIds: string[] = []
    let rolledForward = 0

    for (const order of staleOrders) {
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
        },
      })
    }

    // Reset tables to available
    if (toResetTableIds.length > 0) {
      await db.table.updateMany({
        where: { id: { in: toResetTableIds } },
        data: { status: 'available' },
      })
    }

    // Emit ORDER_CLOSED events for each cancelled order (fire-and-forget)
    for (const id of toCancelIds) {
      void emitOrderEvent(locationId, id, 'ORDER_CLOSED', {
        closedStatus: 'cancelled',
        reason: 'EOD cleanup: stale empty order from previous business day',
      })
    }

    // Fire socket event so all terminals update
    if (toCancelIds.length > 0) {
      void emitToLocation(locationId, 'orders:list-changed', {
        source: 'eod-cleanup',
        cancelledCount: toCancelIds.length,
      }).catch(console.error)
    }

    return NextResponse.json({
      data: {
        cancelled: toCancelIds.length,
        rolledForward,
        cancelledOrderIds: toCancelIds,
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
