/**
 * Shared helpers for third-party delivery webhook routes.
 *
 * Provides HMAC validation, ThirdPartyOrder creation, POS order creation on auto-accept,
 * and socket dispatch for real-time delivery order feed.
 *
 * NOTE: Uses $queryRawUnsafe/$executeRawUnsafe for raw SQL delivery tables
 * (ThirdPartyOrder, DeliveryOrder). All queries use positional $1/$2 params — safe from injection.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { createChildLogger } from '@/lib/logger'
import type { DeliveryPlatform, PlatformItem } from './order-mapper'
import type { DeliveryPlatformId } from './clients/types'
import { mapThirdPartyOrder } from './order-mapper'
import { emitToLocation } from '@/lib/socket-server'

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

/**
 * Fail-closed webhook auth: rejects when secret is missing or signature is absent/invalid.
 * Use this instead of validateHmacSignature to ensure misconfigured webhooks never slip through.
 */
export function validateWebhookAuth(
  platform: string,
  signature: string | null,
  rawBody: string,
  secret: string,
): { valid: boolean; error?: string } {
  if (!secret) {
    return { valid: false, error: `${platform} webhook secret not configured — rejecting request` }
  }
  if (!signature) {
    return { valid: false, error: `${platform} webhook missing signature header` }
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const sigBuffer = Buffer.from(signature, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, error: `${platform} webhook signature length mismatch` }
  }
  const valid = timingSafeEqual(sigBuffer, expectedBuffer)
  return valid ? { valid: true } : { valid: false, error: `${platform} webhook signature invalid` }
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

export interface DeliveryOrderContext {
  thirdPartyOrderId: string
  platform: DeliveryPlatform
  locationId: string
  taxRate: number
  customerName?: string
  customerPhone?: string
  deliveryAddress?: string
  specialInstructions?: string
  deliveryFee?: number
}

/**
 * Create a POS Order from a ThirdPartyOrder and link them.
 * Used when autoAccept is enabled.
 *
 * NOTE: Platform tips do NOT enter tip banking — they're paid by the platform, not the venue.
 */
export async function createPosOrderFromDelivery(
  context: DeliveryOrderContext,
  platformItems: PlatformItem[],
): Promise<string | null> {
  const {
    thirdPartyOrderId,
    platform,
    locationId,
    taxRate,
    customerName,
    customerPhone,
    deliveryAddress,
    specialInstructions,
  } = context

  try {
    const mapped = await mapThirdPartyOrder(platformItems, platform, locationId, taxRate)

    // Build a rich note for kitchen visibility
    const noteParts = [`\u{1F697} ${platform.toUpperCase()} Delivery`]
    if (customerName) noteParts.push(customerName)
    if (customerPhone) noteParts.push(customerPhone)
    const notes = noteParts.join(' | ')
      + (specialInstructions ? `\n${specialInstructions}` : '')

    // Create POS Order with full delivery context
    const orderResult = await db.$queryRawUnsafe<Array<{ id: string; orderNumber: number }>>(
      `INSERT INTO "Order" (
        "locationId", "orderType", "status",
        "subtotal", "tax", "total",
        "customerName", "customerPhone", "deliveryAddress", "deliveryInstructions",
        "notes", "source"
      ) VALUES (
        $1, $2, 'sent', $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11
      )
      RETURNING "id", "orderNumber"`,
      locationId,
      mapped.orderType,
      mapped.subtotal,
      mapped.tax,
      mapped.total,
      customerName || null,
      customerPhone || null,
      deliveryAddress || null,
      specialInstructions || null,
      notes,
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
      const itemRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "OrderItem" (
          "orderId", "menuItemId", "name", "quantity", "price", "locationId",
          "specialNotes"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING "id"`,
        orderId,
        item.menuItemId,
        item.name,
        item.quantity,
        item.price,
        locationId,
        item.specialInstructions || null,
      )

      // Store modifiers on the OrderItem
      const orderItemId = itemRows[0]?.id
      if (orderItemId && item.modifiers && item.modifiers.length > 0) {
        for (const modName of item.modifiers) {
          await db.$executeRawUnsafe(
            `INSERT INTO "OrderItemModifier" ("id", "orderItemId", "name", "price", "quantity", "locationId", "createdAt", "updatedAt")
             VALUES (gen_random_uuid(), $1, $2, 0, 1, $3, NOW(), NOW())`,
            orderItemId, modName, locationId,
          )
        }
      }
    }

    // Emit order events so KDS, kitchen tickets, and cross-terminal sync work
    try {
      const { emitOrderEvent } = await import('@/lib/order-events/emitter')
      await emitOrderEvent(locationId, orderId, 'ORDER_CREATED', {
        orderType: `delivery_${platform}`,
        source: `delivery_${platform}`,
      })
      await emitOrderEvent(locationId, orderId, 'ORDER_SENT', {
        source: `delivery_${platform}`,
      })
    } catch (err) {
      console.error('[webhook-helpers] Failed to emit order events:', err)
    }

    // Emit socket events for POS terminals
    try {
      emitToLocation(locationId, 'orders:list-changed', { source: `delivery_${platform}` })
      emitToLocation(locationId, 'order:summary-updated', { orderId })
    } catch (err) {
      console.error('[webhook-helpers] Failed to emit socket events:', err)
    }

    return orderId
  } catch (error) {
    log.error({ err: error }, `[delivery] Failed to create POS order from ${platform} delivery:`)
    return null
  }
}

// ─── Platform Confirmation (auto-accept path) ──────────────────────────────

/**
 * Confirm an order back to the delivery platform after auto-accept.
 * Fire-and-forget safe — errors are logged but never thrown.
 */
export async function confirmWithPlatform(
  platform: string,
  externalOrderId: string,
  locationId: string,
  prepTimeMinutes?: number,
): Promise<void> {
  try {
    const { getPlatformClient } = await import('@/lib/delivery/clients/platform-registry')
    const { getLocationSettings } = await import('@/lib/location-cache')
    const settings = parseSettings(await getLocationSettings(locationId))
    const client = getPlatformClient(platform as DeliveryPlatformId, settings)
    if (!client) return
    const prepTime = prepTimeMinutes ?? settings.thirdPartyDelivery?.[platform as 'doordash' | 'ubereats' | 'grubhub']?.prepTimeMinutes ?? 20
    await client.confirmOrder(externalOrderId, prepTime)
  } catch (err) {
    console.error(`[webhook-helpers] Failed to confirm ${platform} order ${externalOrderId}:`, err)
  }
}

// ─── Cancel / Void Linked POS Order ─────────────────────────────────────────

/**
 * When a delivery platform cancels an order, void the linked POS order so it
 * doesn't stay open in the kitchen or on reports.
 */
export async function voidLinkedPosOrder(
  thirdPartyOrderId: string,
  locationId: string,
  platform: string,
): Promise<void> {
  try {
    // Find the linked POS order
    const rows = await db.$queryRawUnsafe<Array<{ orderId: string | null }>>(
      `SELECT "orderId" FROM "ThirdPartyOrder" WHERE "id" = $1 AND "locationId" = $2 LIMIT 1`,
      thirdPartyOrderId, locationId,
    )
    const orderId = rows[0]?.orderId
    if (!orderId) return

    // Void the POS order
    await db.$executeRawUnsafe(
      `UPDATE "Order" SET "status" = 'voided', "updatedAt" = NOW() WHERE "id" = $1 AND "locationId" = $2`,
      orderId, locationId,
    )

    // Void all items
    await db.$executeRawUnsafe(
      `UPDATE "OrderItem" SET "status" = 'voided', "updatedAt" = NOW() WHERE "orderId" = $1`,
      orderId,
    )

    // Emit events
    try {
      emitToLocation(locationId, 'orders:list-changed', { source: `cancel_${platform}` })
      emitToLocation(locationId, 'order:summary-updated', { orderId })
      emitToLocation(locationId, 'kds:order-bumped', { orderId })
    } catch { /* socket failure is non-fatal */ }

    log.info(`Voided POS order ${orderId} for cancelled ${platform} order ${thirdPartyOrderId}`)
  } catch (err) {
    log.error({ err }, `Failed to void POS order for ${platform} cancel`)
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
  try {
    void emitToLocation(locationId, event, payload).catch((err: unknown) => log.error({ err }, 'emitToLocation failed'))
  } catch (err) {
    log.error({ err }, 'Failed to load socket-server for delivery event dispatch')
  }
}
