/**
 * Shared helpers for third-party delivery webhook routes.
 *
 * Provides HMAC validation, ThirdPartyOrder creation, POS order creation on auto-accept,
 * and socket dispatch for real-time delivery order feed.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { emitToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'
import type { DeliveryPlatform, PlatformItem } from './order-mapper'
import { mapThirdPartyOrder } from './order-mapper'

const log = createChildLogger('delivery')

// ─── HMAC Signature Validation ──────────────────────────────────────────────

/**
 * Validate an HMAC-SHA256 signature from the webhook request.
 * Returns true if valid, false otherwise.
 */
export function validateHmacSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !secret) return false

  try {
    const expected = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')

    const sigBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expected, 'hex')

    if (sigBuffer.length !== expectedBuffer.length) return false
    return timingSafeEqual(sigBuffer, expectedBuffer)
  } catch {
    return false
  }
}

// ─── Location Resolution ────────────────────────────────────────────────────

interface ResolvedLocation {
  locationId: string
  webhookSecret: string
  autoAccept: boolean
  prepTimeMinutes: number
  autoPrintTicket: boolean
  alertOnNewOrder: boolean
  defaultTaxRate: number
}

/**
 * Resolve which location this webhook belongs to by matching the platform's storeId.
 * Scans all locations' thirdPartyDelivery settings.
 */
export async function resolveLocationForWebhook(
  platform: DeliveryPlatform,
  storeId: string | null,
): Promise<ResolvedLocation | null> {
  const locations = await db.location.findMany({
    where: { deletedAt: null },
    select: { id: true, settings: true },
  })

  const storeIdField = platform === 'grubhub' ? 'storeId' : 'storeId'

  for (const loc of locations) {
    const settings = parseSettings(loc.settings)
    const delivery = settings.thirdPartyDelivery
    if (!delivery) continue

    const platformSettings = delivery[platform]
    if (!platformSettings?.enabled) continue

    // Match by storeId if provided, otherwise accept if only one location is enabled for this platform
    if (storeId && platformSettings.storeId === storeId) {
      return {
        locationId: loc.id,
        webhookSecret: platformSettings.webhookSecret,
        autoAccept: platformSettings.autoAccept,
        prepTimeMinutes: platformSettings.prepTimeMinutes,
        autoPrintTicket: delivery.autoPrintTicket,
        alertOnNewOrder: delivery.alertOnNewOrder,
        defaultTaxRate: delivery.defaultTaxRate,
      }
    }
  }

  // Fallback: if no storeId match but exactly one location has this platform enabled
  if (!storeId) {
    const enabled = locations.filter(loc => {
      const settings = parseSettings(loc.settings)
      return settings.thirdPartyDelivery?.[platform]?.enabled
    })
    if (enabled.length === 1) {
      const settings = parseSettings(enabled[0].settings)
      const delivery = settings.thirdPartyDelivery!
      const platformSettings = delivery[platform]
      return {
        locationId: enabled[0].id,
        webhookSecret: platformSettings.webhookSecret,
        autoAccept: platformSettings.autoAccept,
        prepTimeMinutes: platformSettings.prepTimeMinutes,
        autoPrintTicket: delivery.autoPrintTicket,
        alertOnNewOrder: delivery.alertOnNewOrder,
        defaultTaxRate: delivery.defaultTaxRate,
      }
    }
  }

  return null
}

// ─── ThirdPartyOrder Creation ───────────────────────────────────────────────

interface CreateThirdPartyOrderParams {
  locationId: string
  platform: DeliveryPlatform
  externalOrderId: string
  externalCustomerName?: string
  externalCustomerPhone?: string
  items: PlatformItem[]
  subtotal: number
  tax: number
  deliveryFee: number
  tip: number
  total: number
  specialInstructions?: string
  estimatedPickupAt?: Date
  rawPayload: unknown
}

/**
 * Create a ThirdPartyOrder record. Returns the created record.
 * Upserts on (locationId + platform + externalOrderId) to prevent duplicates.
 */
export async function createThirdPartyOrder(params: CreateThirdPartyOrderParams) {
  // Check for duplicate
  const existing = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "ThirdPartyOrder"
     WHERE "locationId" = $1 AND "platform" = $2 AND "externalOrderId" = $3
     LIMIT 1`,
    params.locationId,
    params.platform,
    params.externalOrderId,
  )

  if (existing.length > 0) {
    return { id: existing[0].id, isDuplicate: true }
  }

  const result = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "ThirdPartyOrder" (
      "locationId", "platform", "externalOrderId",
      "externalCustomerName", "externalCustomerPhone",
      "status", "items", "subtotal", "tax", "deliveryFee", "tip", "total",
      "specialInstructions", "estimatedPickupAt", "rawPayload"
    ) VALUES ($1, $2, $3, $4, $5, 'received', $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
    RETURNING "id"`,
    params.locationId,
    params.platform,
    params.externalOrderId,
    params.externalCustomerName || null,
    params.externalCustomerPhone || null,
    JSON.stringify(params.items),
    params.subtotal,
    params.tax,
    params.deliveryFee,
    params.tip,
    params.total,
    params.specialInstructions || null,
    params.estimatedPickupAt || null,
    JSON.stringify(params.rawPayload),
  )

  return { id: result[0].id, isDuplicate: false }
}

// ─── POS Order Creation (for auto-accept) ───────────────────────────────────

/**
 * Create a POS Order from a ThirdPartyOrder and link them.
 * Used when autoAccept is enabled.
 *
 * NOTE: Platform tips do NOT enter tip banking — they're paid by the platform, not the venue.
 */
export async function createPosOrderFromDelivery(
  thirdPartyOrderId: string,
  platformItems: PlatformItem[],
  platform: DeliveryPlatform,
  locationId: string,
  taxRate: number,
): Promise<string | null> {
  try {
    const mapped = await mapThirdPartyOrder(platformItems, platform, locationId, taxRate)

    // Create a minimal POS Order
    // TODO: When full order creation API is wired, use the proper order creation flow
    // For now, create a basic order record that kitchen can see
    const orderResult = await db.$queryRawUnsafe<Array<{ id: string; orderNumber: number }>>(
      `INSERT INTO "Order" (
        "locationId", "orderType", "status",
        "subtotal", "tax", "total",
        "specialInstructions", "source"
      ) VALUES ($1, $2, 'sent', $3, $4, $5, $6, $7)
      RETURNING "id", "orderNumber"`,
      locationId,
      mapped.orderType,
      mapped.subtotal,
      mapped.tax,
      mapped.total,
      `[${platform.toUpperCase()}] Delivery order`,
      platform,
    )

    if (!orderResult.length) return null
    const orderId = orderResult[0].id

    // Link ThirdPartyOrder to POS Order
    await db.$executeRawUnsafe(
      `UPDATE "ThirdPartyOrder" SET "orderId" = $1, "status" = 'accepted', "updatedAt" = NOW()
       WHERE "id" = $2`,
      orderId,
      thirdPartyOrderId,
    )

    // Create OrderItems for each mapped item
    for (const item of mapped.items) {
      await db.$executeRawUnsafe(
        `INSERT INTO "OrderItem" (
          "orderId", "menuItemId", "name", "quantity", "price", "locationId"
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        orderId,
        item.menuItemId,
        item.name,
        item.quantity,
        item.price,
        locationId,
      )
    }

    return orderId
  } catch (error) {
    log.error({ err: error }, `[delivery] Failed to create POS order from ${platform} delivery:`)
    return null
  }
}

// ─── Status Update ──────────────────────────────────────────────────────────

/**
 * Update a ThirdPartyOrder's status.
 */
export async function updateThirdPartyOrderStatus(
  locationId: string,
  platform: DeliveryPlatform,
  externalOrderId: string,
  status: string,
  extra?: { actualPickupAt?: Date },
): Promise<{ id: string } | null> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string; orderId: string | null }>>(
    `UPDATE "ThirdPartyOrder"
     SET "status" = $1,
         "actualPickupAt" = COALESCE($2, "actualPickupAt"),
         "updatedAt" = NOW()
     WHERE "locationId" = $3 AND "platform" = $4 AND "externalOrderId" = $5
     RETURNING "id", "orderId"`,
    status,
    extra?.actualPickupAt || null,
    locationId,
    platform,
    externalOrderId,
  )

  return rows.length > 0 ? { id: rows[0].id } : null
}

// ─── Socket Dispatch ────────────────────────────────────────────────────────

/**
 * Emit delivery-related socket events to the location room.
 * Fire-and-forget pattern.
 */
export function dispatchDeliveryEvent(
  locationId: string,
  event: 'delivery:new-order' | 'delivery:status-update',
  payload: Record<string, unknown>,
): void {
  void emitToLocation(locationId, event, payload).catch((err) => log.error({ err }, 'emitToLocation failed'))
}
