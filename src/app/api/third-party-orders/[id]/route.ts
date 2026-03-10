/**
 * Third-Party Delivery Order — Detail / Accept / Reject / Status Update
 *
 * GET  /api/third-party-orders/[id] — Order detail with raw payload
 * PUT  /api/third-party-orders/[id] — Accept, reject, or update status
 *
 * On accept: creates a POS Order (orderType: 'delivery_[platform]'), links orderId, sends to kitchen.
 * On reject: updates status. TODO: call platform cancel API when credentials are available.
 * On ready: updates status. TODO: notify platform for pickup when credentials are available.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { createPosOrderFromDelivery, dispatchDeliveryEvent } from '@/lib/delivery/webhook-helpers'
import type { DeliveryPlatform, PlatformItem } from '@/lib/delivery/order-mapper'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'

function toNum(val: unknown): number {
  if (typeof val === 'object' && val && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber()
  }
  return Number(val) || 0
}

// ─── GET — Detail ───────────────────────────────────────────────────────────

export const GET = withVenue(async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "ThirdPartyOrder"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
       LIMIT 1`,
      id,
      locationId,
    )

    if (!rows.length) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const row = rows[0]
    return NextResponse.json({
      data: {
        id: row.id,
        platform: row.platform,
        externalOrderId: row.externalOrderId,
        customerName: row.externalCustomerName,
        customerPhone: row.externalCustomerPhone,
        status: row.status,
        orderId: row.orderId,
        items: row.items,
        subtotal: toNum(row.subtotal),
        tax: toNum(row.tax),
        deliveryFee: toNum(row.deliveryFee),
        tip: toNum(row.tip),
        total: toNum(row.total),
        specialInstructions: row.specialInstructions,
        estimatedPickupAt: row.estimatedPickupAt,
        actualPickupAt: row.actualPickupAt,
        rawPayload: row.rawPayload,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    })
  } catch (error) {
    console.error('[GET /api/third-party-orders/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 })
  }
})

// ─── PUT — Accept / Reject / Status Update ──────────────────────────────────

export const PUT = withVenue(async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const { locationId, employeeId, action, status: newStatus } = body as {
      locationId: string
      employeeId: string
      action?: 'accept' | 'reject' | 'ready' | 'status_update'
      status?: string
    }

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Fetch the order
    const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "ThirdPartyOrder"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
       LIMIT 1`,
      id,
      locationId,
    )

    if (!rows.length) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const order = rows[0]
    const platform = String(order.platform) as DeliveryPlatform
    const externalOrderId = String(order.externalOrderId)

    switch (action) {
      case 'accept': {
        if (order.status !== 'received') {
          return NextResponse.json({ error: 'Order is not in received status' }, { status: 400 })
        }

        // Get tax rate from settings
        const settings = parseSettings(await getLocationSettings(locationId))
        const taxRate = settings.thirdPartyDelivery?.defaultTaxRate || 0

        // Create POS Order
        const platformItems = (order.items || []) as PlatformItem[]
        const posOrderId = await createPosOrderFromDelivery(
          id,
          platformItems,
          platform,
          locationId,
          taxRate,
        )

        if (!posOrderId) {
          // Still mark as accepted even if POS order creation fails
          await db.$executeRawUnsafe(
            `UPDATE "ThirdPartyOrder" SET "status" = 'accepted', "updatedAt" = NOW()
             WHERE "id" = $1`,
            id,
          )
        }

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          thirdPartyOrderId: id,
          platform,
          externalOrderId,
          status: 'accepted',
          posOrderId,
        })

        return NextResponse.json({
          data: { id, status: 'accepted', posOrderId },
        })
      }

      case 'reject': {
        await db.$executeRawUnsafe(
          `UPDATE "ThirdPartyOrder" SET "status" = 'cancelled', "updatedAt" = NOW()
           WHERE "id" = $1`,
          id,
        )

        // TODO: Call platform cancel/reject API when credentials are available
        // For DoorDash: PATCH /drive/v2/deliveries/{external_delivery_id}/cancel
        // For UberEats: POST /v1/eats/orders/{order_id}/deny
        // For Grubhub: POST /restaurant/v1/orders/{order_id}/reject

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          thirdPartyOrderId: id,
          platform,
          externalOrderId,
          status: 'cancelled',
        })

        return NextResponse.json({
          data: { id, status: 'cancelled' },
        })
      }

      case 'ready': {
        await db.$executeRawUnsafe(
          `UPDATE "ThirdPartyOrder" SET "status" = 'ready', "updatedAt" = NOW()
           WHERE "id" = $1`,
          id,
        )

        // TODO: Notify platform that order is ready for pickup
        // For DoorDash: POST /drive/v2/deliveries/{external_delivery_id}/confirm
        // For UberEats: POST /v1/eats/orders/{order_id}/accept_pos_order
        // For Grubhub: POST /restaurant/v1/orders/{order_id}/ready

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          thirdPartyOrderId: id,
          platform,
          externalOrderId,
          status: 'ready',
        })

        return NextResponse.json({
          data: { id, status: 'ready' },
        })
      }

      case 'status_update': {
        if (!newStatus) {
          return NextResponse.json({ error: 'status is required' }, { status: 400 })
        }

        const validStatuses = ['received', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled']
        if (!validStatuses.includes(newStatus)) {
          return NextResponse.json({ error: `Invalid status: ${newStatus}` }, { status: 400 })
        }

        await db.$executeRawUnsafe(
          `UPDATE "ThirdPartyOrder" SET "status" = $1, "updatedAt" = NOW()
           WHERE "id" = $2`,
          newStatus,
          id,
        )

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          thirdPartyOrderId: id,
          platform,
          externalOrderId,
          status: newStatus,
        })

        return NextResponse.json({
          data: { id, status: newStatus },
        })
      }

      default: {
        return NextResponse.json({ error: 'Invalid action. Use: accept, reject, ready, status_update' }, { status: 400 })
      }
    }
  } catch (error) {
    console.error('[PUT /api/third-party-orders/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }
})
