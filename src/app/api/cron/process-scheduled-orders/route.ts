import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchOpenOrdersChanged, dispatchNewOrder } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET /api/cron/process-scheduled-orders
// Fires scheduled orders whose scheduledFor time has arrived.
// Moves them from draft/open+scheduled to open (ready for prep).
// Designed to be called by an external cron every 1-2 minutes.
export async function GET(_request: NextRequest) {
  try {
    const now = new Date()

    // Find orders where scheduledFor <= now and status is 'draft' or 'open'
    // Uses raw query because scheduledFor is a raw column (not in Prisma schema)
    const scheduledOrders = await db.$queryRawUnsafe<{
      id: string
      locationId: string
      employeeId: string
      orderNumber: number
      orderType: string
      status: string
      scheduledFor: Date
    }[]>(`
      SELECT id, "locationId", "employeeId", "orderNumber", "orderType", status, "scheduledFor"
      FROM "Order"
      WHERE "scheduledFor" IS NOT NULL
        AND "scheduledFor" <= $1
        AND status IN ('draft', 'open')
        AND "deletedAt" IS NULL
      ORDER BY "scheduledFor" ASC
      LIMIT 50
    `, now)

    if (scheduledOrders.length === 0) {
      return NextResponse.json({ data: { processed: 0 } })
    }

    let processed = 0
    const errors: string[] = []

    for (const order of scheduledOrders) {
      try {
        // Update order: set status to 'open' if draft, mark as fired
        // Clear scheduledFor so it won't be re-processed
        if (order.status === 'draft') {
          await db.$executeRawUnsafe(`
            UPDATE "Order"
            SET status = 'open', "scheduledFor" = NULL, "updatedAt" = NOW()
            WHERE id = $1 AND "deletedAt" IS NULL
          `, order.id)
        } else {
          // Already 'open' — just clear scheduledFor to mark as processed
          await db.$executeRawUnsafe(`
            UPDATE "Order"
            SET "scheduledFor" = NULL, "updatedAt" = NOW()
            WHERE id = $1 AND "deletedAt" IS NULL
          `, order.id)
        }

        // Emit order event (fire-and-forget)
        void emitOrderEvent(order.locationId, order.id, 'ORDER_SENT', {
          source: 'scheduled_order_cron',
          scheduledFor: order.scheduledFor.toISOString(),
        })

        // Dispatch socket events so terminals see the order appear
        void dispatchOpenOrdersChanged(order.locationId, {
          trigger: 'updated',
          orderId: order.id,
        }, { async: true }).catch(() => {})

        // Audit log (fire-and-forget)
        void db.auditLog.create({
          data: {
            locationId: order.locationId,
            employeeId: order.employeeId,
            action: 'scheduled_order_fired',
            entityType: 'order',
            entityId: order.id,
            details: {
              orderNumber: order.orderNumber,
              scheduledFor: order.scheduledFor.toISOString(),
              firedAt: now.toISOString(),
            },
          },
        }).catch(() => {})

        processed++
      } catch (err) {
        const msg = `Failed to fire order ${order.id}: ${err instanceof Error ? err.message : String(err)}`
        console.error(msg)
        errors.push(msg)
      }
    }

    return NextResponse.json({
      data: {
        processed,
        total: scheduledOrders.length,
        errors: errors.length > 0 ? errors : undefined,
      },
    })
  } catch (error) {
    console.error('Failed to process scheduled orders:', error)
    return NextResponse.json(
      { error: 'Failed to process scheduled orders' },
      { status: 500 }
    )
  }
}
