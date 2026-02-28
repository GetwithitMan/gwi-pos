/**
 * POST /api/internal/dispatch-online-order
 *
 * Finds online orders with status 'received' (paid on Vercel but not yet
 * dispatched to kitchen) and runs them through the normal send pipeline,
 * triggering KDS socket events and kitchen printer jobs on the NUC.
 *
 * Called by:
 *   - The NUC's online order worker (src/lib/online-order-worker.ts) every 15s
 *   - Future: direct relay from Vercel when/if the NUC gets a public URL
 *
 * Auth: x-api-key header must match PROVISION_API_KEY
 *
 * Body:
 *   { locationId?: string }   — optional, filters to a specific location
 *   { orderId?: string }      — optional, dispatch a single specific order
 *
 * Response:
 *   { found: number, dispatched: number, errors?: string[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'

const PORT = process.env.PORT || '3005'

export const POST = withVenue(async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PROVISION_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as {
    locationId?: string
    orderId?: string
  }

  // ── Find received online orders ───────────────────────────────────────────
  // 'received' = payment approved on Vercel, items have kitchenStatus 'pending',
  // but NUC hasn't dispatched to KDS/printers yet.
  const orders = await db.order.findMany({
    where: {
      status: 'received',
      ...(body.orderId ? { id: body.orderId } : {}),
      ...(body.locationId ? { locationId: body.locationId } : {}),
    },
    select: { id: true, locationId: true, orderNumber: true, notes: true },
    orderBy: { createdAt: 'asc' },
    take: 20, // Safety cap per cycle
  })

  let dispatched = 0
  const errors: string[] = []

  for (const order of orders) {
    try {
      // ── Atomic claim: received → open ────────────────────────────────────
      // This prevents double-dispatch if two worker cycles overlap.
      // If another cycle already claimed it, updateMany returns count: 0 and
      // we skip it cleanly.
      const claimed = await db.order.updateMany({
        where: { id: order.id, status: 'received' },
        data: { status: 'open' },
      })

      if (claimed.count === 0) {
        // Already claimed by a concurrent cycle — skip
        continue
      }

      // Fire-and-forget event emission for dispatch claim
      void emitOrderEvent(order.locationId, order.id, 'ORDER_METADATA_UPDATED', {
        status: 'open',
        source: 'online',
        dispatchedAt: new Date().toISOString(),
      }).catch(console.error)

      // ── Call the existing send pipeline ──────────────────────────────────
      // /api/orders/[id]/send handles:
      //   • item kitchenStatus: pending → sent
      //   • OrderRouter tag-based routing
      //   • dispatchNewOrder() → kds:order-received socket to KDS screens
      //   • printKitchenTicketsForManifests() → kitchen printer jobs
      const sendRes = await fetch(
        `http://localhost:${PORT}/api/orders/${order.id}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      )

      if (sendRes.ok) {
        dispatched++
        console.log(
          `[DispatchOnlineOrder] Order #${order.orderNumber} dispatched to kitchen`
        )
      } else {
        const err = await sendRes.json().catch(() => ({})) as { error?: string }
        const msg = err.error || `HTTP ${sendRes.status}`
        errors.push(`Order #${order.orderNumber}: ${msg}`)

        // Revert so the next worker cycle retries
        await db.order
          .update({ where: { id: order.id }, data: { status: 'received' } })
          .catch(() => {})

        console.error(
          `[DispatchOnlineOrder] Order #${order.orderNumber} send failed: ${msg}`
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Order #${order.orderNumber}: ${msg}`)

      // Revert on exception so it gets retried
      await db.order
        .update({ where: { id: order.id }, data: { status: 'received' } })
        .catch(() => {})

      console.error(
        `[DispatchOnlineOrder] Order #${order.orderNumber} exception:`,
        err
      )
    }
  }

  return NextResponse.json({
    found: orders.length,
    dispatched,
    ...(errors.length > 0 ? { errors } : {}),
  })
})
