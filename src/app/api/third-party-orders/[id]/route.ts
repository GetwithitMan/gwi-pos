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

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { createPosOrderFromDelivery, dispatchDeliveryEvent } from '@/lib/delivery/webhook-helpers'
import type { DeliveryPlatform, PlatformItem } from '@/lib/delivery/order-mapper'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { getPlatformClient } from '@/lib/delivery/clients/platform-registry'
import type { DeliveryPlatformId } from '@/lib/delivery/clients/types'
import { err, notFound, ok } from '@/lib/api-response'

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
      return err('Location ID is required')
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "ThirdPartyOrder"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
       LIMIT 1`,
      id,
      locationId,
    )

    if (!rows.length) {
      return notFound('Order not found')
    }

    const row = rows[0]
    return ok({
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
      })
  } catch (error) {
    console.error('[GET /api/third-party-orders/[id]] Error:', error)
    return err('Failed to fetch order', 500)
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
      return err('Location ID is required')
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
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
      return notFound('Order not found')
    }

    const order = rows[0]
    const platform = String(order.platform) as DeliveryPlatform
    const externalOrderId = String(order.externalOrderId)

    switch (action) {
      case 'accept': {
        if (order.status !== 'received') {
          return err('Order is not in received status')
        }

        // Get tax rate from settings
        const settings = parseSettings(await getLocationSettings(locationId))
        const taxRate = settings.thirdPartyDelivery?.defaultTaxRate || 0

        // Create POS Order
        const platformItems = (order.items || []) as PlatformItem[]
        const posOrderId = await createPosOrderFromDelivery({
          thirdPartyOrderId: id,
          platform,
          locationId,
          taxRate,
          customerName: order.externalCustomerName ? String(order.externalCustomerName) : undefined,
          customerPhone: order.externalCustomerPhone ? String(order.externalCustomerPhone) : undefined,
          specialInstructions: order.specialInstructions ? String(order.specialInstructions) : undefined,
          deliveryFee: toNum(order.deliveryFee),
        }, platformItems)

        if (!posOrderId) {
          // Still mark as accepted even if POS order creation fails
          await db.$executeRawUnsafe(
            `UPDATE "ThirdPartyOrder" SET "status" = 'accepted', "updatedAt" = NOW()
             WHERE "id" = $1`,
            id,
          )
        }

        // Confirm with platform (best-effort, don't block response)
        const acceptSettings = parseSettings(await getLocationSettings(locationId))
        const acceptClient = getPlatformClient(platform as DeliveryPlatformId, acceptSettings)
        const prepTime = acceptSettings.thirdPartyDelivery?.[platform as 'doordash' | 'ubereats' | 'grubhub']?.prepTimeMinutes ?? 20
        if (acceptClient) {
          void acceptClient.confirmOrder(externalOrderId, prepTime)
            .catch(err => console.error(`[third-party-orders] Failed to confirm ${platform} order:`, err))
        }

        pushUpstream()

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          thirdPartyOrderId: id,
          platform,
          externalOrderId,
          status: 'accepted',
          posOrderId,
        })

        return ok({ id, status: 'accepted', posOrderId })
      }

      case 'reject': {
        await db.$executeRawUnsafe(
          `UPDATE "ThirdPartyOrder" SET "status" = 'cancelled', "updatedAt" = NOW()
           WHERE "id" = $1`,
          id,
        )

        pushUpstream()

        // Notify platform of rejection (best-effort, don't block response)
        const rejectSettings = parseSettings(await getLocationSettings(locationId))
        const rejectClient = getPlatformClient(platform as DeliveryPlatformId, rejectSettings)
        if (rejectClient) {
          void rejectClient.rejectOrder(externalOrderId, body.reason || 'Rejected by restaurant')
            .catch(err => console.error(`[third-party-orders] Failed to notify ${platform} of rejection:`, err))
        }

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          thirdPartyOrderId: id,
          platform,
          externalOrderId,
          status: 'cancelled',
        })

        return ok({ id, status: 'cancelled' })
      }

      case 'ready': {
        await db.$executeRawUnsafe(
          `UPDATE "ThirdPartyOrder" SET "status" = 'ready', "updatedAt" = NOW()
           WHERE "id" = $1`,
          id,
        )

        pushUpstream()

        // Notify platform that order is ready for pickup (best-effort)
        const readySettings = parseSettings(await getLocationSettings(locationId))
        const readyClient = getPlatformClient(platform as DeliveryPlatformId, readySettings)
        if (readyClient) {
          void readyClient.markReady(externalOrderId)
            .catch(err => console.error(`[third-party-orders] Failed to notify ${platform} of ready:`, err))
        }

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          thirdPartyOrderId: id,
          platform,
          externalOrderId,
          status: 'ready',
        })

        return ok({ id, status: 'ready' })
      }

      case 'status_update': {
        if (!newStatus) {
          return err('status is required')
        }

        const validStatuses = ['received', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled']
        if (!validStatuses.includes(newStatus)) {
          return err(`Invalid status: ${newStatus}`)
        }

        await db.$executeRawUnsafe(
          `UPDATE "ThirdPartyOrder" SET "status" = $1, "updatedAt" = NOW()
           WHERE "id" = $2`,
          newStatus,
          id,
        )

        pushUpstream()

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          thirdPartyOrderId: id,
          platform,
          externalOrderId,
          status: newStatus,
        })

        return ok({ id, status: newStatus })
      }

      default: {
        return err('Invalid action. Use: accept, reject, ready, status_update')
      }
    }
  } catch (error) {
    console.error('[PUT /api/third-party-orders/[id]] Error:', error)
    return err('Failed to update order', 500)
  }
})
