import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'

// TEMPORARY: Purge all orders for a location (dev/test use only)
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, confirm } = body

    if (!locationId || confirm !== 'DELETE_ALL_ORDERS') {
      return NextResponse.json(
        { error: 'Must provide locationId and confirm: "DELETE_ALL_ORDERS"' },
        { status: 400 }
      )
    }

    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PURGE) {
      return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 })
    }

    const results: string[] = []

    async function safeExec(label: string, sql: string, params: any[] = []) {
      try {
        const result = await db.$executeRawUnsafe(sql, ...params)
        if (result > 0) results.push(`${label}: ${result} rows deleted`)
      } catch (e: any) {
        const msg = e.meta?.message || e.message || e.code
        if (!msg.includes('does not exist')) {
          results.push(`${label}: skipped - ${msg.slice(0, 100)}`)
        }
      }
    }

    // Get all order IDs
    const orderRows = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Order" WHERE "locationId" = $1`, locationId
    )
    if (orderRows.length === 0) {
      return NextResponse.json({ data: { message: 'No orders found', remaining: 0 } })
    }
    results.push(`Found ${orderRows.length} orders`)

    const oidArray = orderRows.map(r => r.id)

    // Get all order item IDs (parameterized)
    const itemRows = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "OrderItem" WHERE "orderId" = ANY($1::text[])`, oidArray
    )
    const iidArray = itemRows.map(r => r.id)

    // === LEAF TABLES (reference OrderItem) ===
    if (iidArray.length > 0) {
      await safeExec('OrderItemModifier', `DELETE FROM "OrderItemModifier" WHERE "orderItemId" = ANY($1::text[])`, [iidArray])
      await safeExec('OrderItemDiscount', `DELETE FROM "OrderItemDiscount" WHERE "orderItemId" = ANY($1::text[])`, [iidArray])
      await safeExec('OrderItemPizza', `DELETE FROM "OrderItemPizza" WHERE "orderItemId" = ANY($1::text[])`, [iidArray])
    }

    // === TABLES REFERENCING Order ===
    // All models from schema that have orderId FK
    const orderFkTables = [
      'Payment', 'OrderDiscount', 'OrderEvent', 'OrderOwnership',
      'TipTransaction', 'TipLedgerEntry', 'VoidLog', 'RefundLog',
      'PrintJob', 'DigitalReceipt', 'OrderCard', 'FulfillmentEvent',
      'PmsChargeAttempt', 'CouponRedemption', 'SpiritUpsellEvent',
      'WalkoutRetry', 'RemoteVoidApproval', 'TimedSession', 'SyncAuditEntry',
      'PendingDeduction',
    ]
    for (const table of orderFkTables) {
      await safeExec(table, `DELETE FROM "${table}" WHERE "orderId" = ANY($1::text[])`, [oidArray])
    }

    // AuditLog (uses entityId, not orderId)
    await safeExec('AuditLog', `DELETE FROM "AuditLog" WHERE "entityType" = 'order' AND "entityId" = ANY($1::text[])`, [oidArray])

    // Snapshots
    const snapRows = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "OrderSnapshot" WHERE "orderId" = ANY($1::text[])`, oidArray
    ).catch(() => [] as { id: string }[])
    if (snapRows.length > 0) {
      const sidArray = snapRows.map(r => r.id)
      await safeExec('OrderItemSnapshot', `DELETE FROM "OrderItemSnapshot" WHERE "orderSnapshotId" = ANY($1::text[])`, [sidArray])
      await safeExec('OrderSnapshot', `DELETE FROM "OrderSnapshot" WHERE id = ANY($1::text[])`, [sidArray])
    }

    // === OrderItem ===
    if (iidArray.length > 0) {
      await safeExec('OrderItem', `DELETE FROM "OrderItem" WHERE id = ANY($1::text[])`, [iidArray])
    }

    // === Order (children first) ===
    await safeExec('Order (children)', `DELETE FROM "Order" WHERE "locationId" = $1 AND "parentOrderId" IS NOT NULL`, [locationId])
    await safeExec('Order', `DELETE FROM "Order" WHERE "locationId" = $1`, [locationId])

    const remaining = await db.order.count({ where: { locationId } })
    results.push(`Remaining: ${remaining}`)

    return NextResponse.json({ data: { results, remaining } })
  } catch (error: any) {
    console.error('Purge orders error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}))
