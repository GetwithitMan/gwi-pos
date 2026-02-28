/**
 * Pending Auth Recovery API
 *
 * GET  /api/system/recovery/pending-auth
 *   Find all orders stuck in tabStatus='pending_auth' for more than 5 minutes.
 *
 * POST /api/system/recovery/pending-auth
 *   Reset a specific order from 'pending_auth' back to 'open' and log to AuditLog.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'

const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

export const GET = withVenue(async function GET() {
  const fiveMinAgo = new Date(Date.now() - STALE_THRESHOLD_MS)

  // Read from OrderSnapshot (event-sourced projection)
  const staleOrders = await db.orderSnapshot.findMany({
    where: {
      tabStatus: 'pending_auth',
      updatedAt: { lt: fiveMinAgo },
      deletedAt: null,
    },
    select: {
      id: true,
      orderNumber: true,
      tabName: true,
      locationId: true,
      updatedAt: true,
      createdAt: true,
    },
    orderBy: { updatedAt: 'asc' },
  })

  return NextResponse.json({
    data: staleOrders.map(o => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      tabName: o.tabName,
      locationId: o.locationId,
      stuckSince: o.updatedAt,
      ageMinutes: Math.round((Date.now() - o.updatedAt.getTime()) / 60000),
    })),
    count: staleOrders.length,
  })
})

export const POST = withVenue(async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { orderId, employeeId } = body

  if (!orderId) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  }

  const order = await db.order.findFirst({
    where: { id: orderId, tabStatus: 'pending_auth', deletedAt: null },
    select: { id: true, locationId: true, orderNumber: true, updatedAt: true },
  })

  if (!order) {
    return NextResponse.json({ error: 'Order not found or not in pending_auth state' }, { status: 404 })
  }

  // Reset to open
  await db.order.update({
    where: { id: orderId },
    data: { tabStatus: 'open', version: { increment: 1 } },
  })

  // Log to AuditLog
  await db.auditLog.create({
    data: {
      locationId: order.locationId,
      employeeId: employeeId || null,
      action: 'pending_auth_recovery',
      entityType: 'order',
      entityId: orderId,
      details: {
        orderNumber: order.orderNumber,
        previousStatus: 'pending_auth',
        newStatus: 'open',
        stuckSince: order.updatedAt.toISOString(),
        recoveredAt: new Date().toISOString(),
      },
    },
  })

  // Emit ORDER_METADATA_UPDATED for the tabStatus recovery (fire-and-forget)
  void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', {
    tabName: null,
    tableId: null,
    tableName: null,
    employeeId: employeeId || null,
  })

  return NextResponse.json({
    data: {
      success: true,
      orderId,
      previousStatus: 'pending_auth',
      newStatus: 'open',
    },
  })
})
