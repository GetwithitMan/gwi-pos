import { NextRequest, NextResponse } from 'next/server'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { notifyNuc } from '@/lib/cron-nuc-notify'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cron.process-scheduled-orders')

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET /api/cron/process-scheduled-orders
// Fires scheduled orders whose scheduledFor time has arrived.
// Moves them from draft/open+scheduled to open (ready for prep).
// Designed to be called by an external cron every 1-2 minutes.
export async function GET(request: NextRequest) {
  const cronAuthError = verifyCronSecret(request.headers.get('authorization'))
  if (cronAuthError) return cronAuthError

  const allResults: Record<string, unknown> = {}

  const summary = await forAllVenues(async (venueDb, slug) => {
    const now = new Date()

    // Find orders where scheduledFor <= now and status is 'draft' or 'open'
    // Uses raw query because scheduledFor is a raw column (not in Prisma schema)
    const scheduledOrders = await venueDb.$queryRawUnsafe<{
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
      allResults[slug] = { processed: 0 }
      return
    }

    let processed = 0
    const errors: string[] = []

    for (const order of scheduledOrders) {
      try {
        // Update order: set status to 'open' if draft, mark as fired
        // Clear scheduledFor so it won't be re-processed
        if (order.status === 'draft') {
          await venueDb.$executeRawUnsafe(`
            UPDATE "Order"
            SET status = 'open', "scheduledFor" = NULL, "updatedAt" = NOW()
            WHERE id = $1 AND "deletedAt" IS NULL
          `, order.id)
        } else {
          // Already 'open' — just clear scheduledFor to mark as processed
          await venueDb.$executeRawUnsafe(`
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
        if (process.env.VERCEL) {
          void notifyNuc(slug, 'OPEN_ORDERS_CHANGED', {
            locationId: order.locationId,
            trigger: 'updated',
            orderId: order.id,
          }).catch(err => log.warn({ err }, 'fire-and-forget failed in cron.process-scheduled-orders'))
        } else {
          void dispatchOpenOrdersChanged(order.locationId, {
            trigger: 'updated',
            orderId: order.id,
          }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in cron.process-scheduled-orders'))
        }

        // Audit log (fire-and-forget)
        void venueDb.auditLog.create({
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
        }).catch(err => log.warn({ err }, 'fire-and-forget failed in cron.process-scheduled-orders'))

        processed++
      } catch (err) {
        const msg = `Failed to fire order ${order.id}: ${err instanceof Error ? err.message : String(err)}`
        console.error(`[cron:process-scheduled-orders] Venue ${slug}: ${msg}`)
        errors.push(msg)
      }
    }

    allResults[slug] = {
      processed,
      total: scheduledOrders.length,
      errors: errors.length > 0 ? errors : undefined,
    }
  }, { label: 'cron:process-scheduled-orders' })

  return NextResponse.json({ ...summary, data: allResults })
}
