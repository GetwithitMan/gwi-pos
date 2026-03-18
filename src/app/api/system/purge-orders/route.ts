import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// TEMPORARY: Purge all orders for a location (dev/test use only)
export const POST = withVenue(async function POST(request: NextRequest) {
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

    const oids = orderRows.map(r => `'${r.id}'`).join(',')

    // Get all order item IDs
    const itemRows = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "OrderItem" WHERE "orderId" IN (${oids})`
    )
    const iids = itemRows.map(r => `'${r.id}'`).join(',')

    // === LEAF TABLES (reference OrderItem) ===
    if (iids) {
      await safeExec('OrderItemModifier', `DELETE FROM "OrderItemModifier" WHERE "orderItemId" IN (${iids})`)
      await safeExec('OrderItemDiscount', `DELETE FROM "OrderItemDiscount" WHERE "orderItemId" IN (${iids})`)
      await safeExec('OrderItemPizza', `DELETE FROM "OrderItemPizza" WHERE "orderItemId" IN (${iids})`)
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
      await safeExec(table, `DELETE FROM "${table}" WHERE "orderId" IN (${oids})`)
    }

    // AuditLog (uses entityId, not orderId)
    await safeExec('AuditLog', `DELETE FROM "AuditLog" WHERE "entityType" = 'order' AND "entityId" IN (${oids})`)

    // Snapshots
    const snapRows = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "OrderSnapshot" WHERE "orderId" IN (${oids})`
    ).catch(() => [] as { id: string }[])
    if (snapRows.length > 0) {
      const sids = snapRows.map(r => `'${r.id}'`).join(',')
      await safeExec('OrderItemSnapshot', `DELETE FROM "OrderItemSnapshot" WHERE "orderSnapshotId" IN (${sids})`)
      await safeExec('OrderSnapshot', `DELETE FROM "OrderSnapshot" WHERE id IN (${sids})`)
    }

    // === OrderItem ===
    if (iids) {
      await safeExec('OrderItem', `DELETE FROM "OrderItem" WHERE id IN (${iids})`)
    }

    // === Order (children first) ===
    await safeExec('Order (children)', `DELETE FROM "Order" WHERE "locationId" = $1 AND "parentOrderId" IS NOT NULL`, [locationId])
    await safeExec('Order', `DELETE FROM "Order" WHERE "locationId" = $1`, [locationId])

    const remaining = await adminDb.order.count({ where: { locationId } })
    results.push(`Remaining: ${remaining}`)

    return NextResponse.json({ data: { results, remaining } })
  } catch (error: any) {
    console.error('Purge orders error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
})
