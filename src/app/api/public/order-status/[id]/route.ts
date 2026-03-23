/**
 * GET /api/public/order-status/[id] — Token-gated order status
 *
 * No session auth. Requires ?token= query param (HMAC-SHA256 of orderId).
 * Returns order status, items, totals, and estimated ready time.
 *
 * Cache-Control: private, no-store (user-specific data).
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ── Token Helpers (exported for checkout route) ──────────────────────────────

export function generateOrderViewToken(orderId: string): string {
  const secret = process.env.PROVISION_API_KEY || 'fallback-secret'
  return crypto.createHmac('sha256', secret).update(orderId).digest('hex')
}

function verifyOrderViewToken(orderId: string, token: string): boolean {
  const expected = generateOrderViewToken(orderId)
  if (expected.length !== token.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}

// ── Status Mapping ───────────────────────────────────────────────────────────

type PublicOrderStatus =
  | 'received'
  | 'open'
  | 'in_progress'
  | 'sent'
  | 'completed'
  | 'voided'
  | 'canceled'

function mapOrderStatus(dbStatus: string): PublicOrderStatus {
  switch (dbStatus) {
    case 'received':
      return 'received'
    case 'open':
      return 'open'
    case 'in_progress':
      return 'in_progress'
    case 'sent':
      return 'sent'
    case 'completed':
    case 'paid':
    case 'closed':
      return 'completed'
    case 'voided':
      return 'voided'
    case 'cancelled':
    case 'canceled':
      return 'canceled'
    default:
      return 'open'
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  context: any,
) {
  try {
    const { id } = (await context.params) as { id: string }
    const token = request.nextUrl.searchParams.get('token')

    if (!id || !token) {
      return NextResponse.json(
        { error: 'Order ID and token are required' },
        { status: 400 }
      )
    }

    // Verify HMAC token
    if (!verifyOrderViewToken(id, token)) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 403 }
      )
    }

    // Fetch order with items and location
    const order = await db.order.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        orderType: true,
        createdAt: true,
        subtotal: true,
        taxTotal: true,
        tipTotal: true,
        total: true,
        source: true,
        notes: true,
        location: {
          select: {
            name: true,
            address: true,
            settings: true,
          },
        },
        items: {
          where: { deletedAt: null },
          select: {
            name: true,
            price: true,
            quantity: true,
            modifiers: {
              select: { name: true },
            },
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Compute estimated ready time from settings
    const locSettings = order.location?.settings as Record<string, unknown> | null
    const onlineSettings = locSettings?.onlineOrdering as Record<string, unknown> | null
    const prepTimeMinutes = (onlineSettings?.prepTime as number | undefined) ?? 20

    const createdAt = new Date(order.createdAt)
    const estimatedReadyTime = new Date(createdAt.getTime() + prepTimeMinutes * 60 * 1000).toISOString()

    const response = {
      orderId: order.id,
      orderNumber: String(order.orderNumber),
      status: mapOrderStatus(order.status),
      orderType: order.orderType ?? 'takeout',
      createdAt: order.createdAt.toISOString(),
      estimatedReadyTime,
      items: order.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: Number(item.price),
        modifiers: item.modifiers.map(m => m.name),
      })),
      subtotal: Number(order.subtotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      total: Number(order.total),
      pickupAddress: order.location?.address ?? null,
      source: order.source ?? 'online',
    }

    return NextResponse.json({ data: response }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('[GET /api/public/order-status/[id]] Error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
