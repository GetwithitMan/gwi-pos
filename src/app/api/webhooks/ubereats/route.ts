/**
 * UberEats Webhook Receiver
 *
 * POST /api/webhooks/ubereats
 *
 * Receives UberEats webhook events. Validates HMAC signature.
 * Event types: orders.notification, orders.cancel
 *
 * IMPORTANT: The `orders.notification` webhook is a THIN notification — it does NOT
 * contain the full order object. We must fetch the full order via GET /v2/eats/order/{id}.
 *
 * HMAC: UberEats uses the OAuth `client_secret` as the HMAC signing key, not a separate
 * webhook secret. The admin UI should instruct users to put their `client_secret` in the
 * webhookSecret field, OR we fall back to `uberEatsCredentials.clientSecret`.
 *
 * No auth (public endpoint) — validated by HMAC signature.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  validateHmacSignature,
  resolveLocationForWebhook,
  createThirdPartyOrder,
  createPosOrderFromDelivery,
  updateThirdPartyOrderStatus,
  dispatchDeliveryEvent,
  confirmWithPlatform,
  voidLinkedPosOrder,
} from '@/lib/delivery/webhook-helpers'
import { normalizeUberEatsItems } from '@/lib/delivery/order-mapper'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { getPlatformClient } from '@/lib/delivery/clients/platform-registry'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = String(payload.event_type || payload.resource_type || '')
  const storeId = String(payload.store_id || payload.restaurant_id || '')
  const meta = (payload.meta || {}) as Record<string, unknown>
  const externalOrderId = String(payload.order_id || meta.resource_id || '')

  // Resolve location by storeId
  const location = await resolveLocationForWebhook('ubereats', storeId || null)
  if (!location) {
    console.error('[ubereats/webhook] No matching location for storeId:', storeId)
    return NextResponse.json({ received: true })
  }

  // ── Fix 4 + 5: Fail closed on missing secret; use clientSecret as HMAC fallback ──
  // UberEats uses the OAuth client_secret as the HMAC key, not a separate webhook secret.
  // Check webhookSecret first, fall back to uberEatsCredentials.clientSecret.
  const locationSettings = parseSettings(await getLocationSettings(location.locationId))
  const uberEatsCredentials = locationSettings?.thirdPartyDelivery?.uberEatsCredentials
  const hmacKey = location.webhookSecret || uberEatsCredentials?.clientSecret || ''

  const signature = request.headers.get('x-uber-signature')
    || request.headers.get('x-signature')

  if (!hmacKey) {
    // Fix 4: Fail closed — reject when no secret is configured
    console.error('[ubereats/webhook] CRITICAL: No webhookSecret or clientSecret configured — rejecting request.', location.locationId)
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 })
  } else if (!validateHmacSignature(rawBody, signature, hmacKey)) {
    console.error('[ubereats/webhook] HMAC validation failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const { locationId } = location

  try {
    switch (eventType) {
      case 'orders.notification':
      case 'order.created': {
        // ── Fix 1: UberEats `orders.notification` is a thin notification ──
        // The webhook payload does NOT contain the order object — only metadata.
        // We must extract the order ID and GET the full order from UberEats API.
        const orderId = String(meta.resource_id || meta.order_id || payload.order_id || '')
        if (!orderId) {
          console.warn('[ubereats/webhook] orders.notification with no resource_id — ignoring')
          return NextResponse.json({ received: true })
        }

        // Fetch the full order from UberEats API
        let orderData: Record<string, unknown>
        const client = getPlatformClient('ubereats', locationSettings)
        if (client && 'getOrder' in client) {
          try {
            orderData = await (client as { getOrder: (id: string) => Promise<Record<string, unknown>> }).getOrder(orderId)
          } catch (fetchErr) {
            console.error('[ubereats/webhook] Failed to fetch full order from UberEats API:', fetchErr)
            // Fall back to webhook payload (will have limited data)
            orderData = (payload.order || payload) as Record<string, unknown>
          }
        } else {
          console.warn('[ubereats/webhook] No UberEats client available to fetch full order, using webhook payload')
          orderData = (payload.order || payload) as Record<string, unknown>
        }

        // Parse customer from the full order response
        // Full response has: eater.first_name, eater.last_name, eater.phone.number
        const eater = (orderData.eater || orderData.customer || {}) as Record<string, unknown>
        const customerName = String(eater.first_name || '') +
          (eater.last_name ? ` ${eater.last_name}` : '')
        const phoneObj = eater.phone as Record<string, unknown> | undefined
        const customerPhone = String(phoneObj?.number || (typeof eater?.phone === 'string' ? eater.phone : '') || '')

        // Parse delivery address from UberEats full order response
        // Full response has: dropoff.location.address, dropoff.location.address2, dropoff.location.city, etc.
        const dropoff = (orderData.dropoff || orderData.delivery_address || {}) as Record<string, unknown>
        const dropoffLocation = (dropoff.location || dropoff) as Record<string, unknown>
        const deliveryAddress = dropoffLocation.formatted_address
          ? String(dropoffLocation.formatted_address)
          : [
              dropoffLocation.address || dropoffLocation.address_line_1 || '',
              dropoffLocation.address2 || dropoffLocation.address_line_2 || '',
              dropoffLocation.city || '',
              dropoffLocation.state || '',
              dropoffLocation.postal_code || dropoffLocation.zip_code || '',
            ].filter(Boolean).join(', ') || ''

        // Parse items from the full order (cart.items[])
        const items = normalizeUberEatsItems(orderData)

        // Parse pricing from the full order response
        // Full response has: payment.charges.{total,sub_total,tax,delivery_fee,tip}.amount (cents)
        const payment = (orderData.payment || {}) as Record<string, unknown>
        const charges = (payment.charges || orderData.charges || {}) as Record<string, unknown>
        const subTotalObj = (charges.sub_total || {}) as Record<string, unknown>
        const taxObj = (charges.tax || {}) as Record<string, unknown>
        const deliveryFeeObj = (charges.delivery_fee || {}) as Record<string, unknown>
        const tipObj = (charges.tip || {}) as Record<string, unknown>
        const totalObj = (charges.total || {}) as Record<string, unknown>
        const subtotal = Number(subTotalObj.amount || orderData.subtotal || 0) / 100
        const tax = Number(taxObj.amount || orderData.tax || 0) / 100
        const deliveryFee = Number(deliveryFeeObj.amount || orderData.delivery_fee || 0) / 100
        const tip = Number(tipObj.amount || orderData.tip || 0) / 100
        const total = Number(totalObj.amount || orderData.total || 0) / 100

        const specialInstructions = String(orderData.special_instructions || '')
        const estimatedPickup = orderData.estimated_ready_for_pickup_at
          ? new Date(String(orderData.estimated_ready_for_pickup_at))
          : undefined

        const result = await createThirdPartyOrder({
          locationId,
          platform: 'ubereats',
          externalOrderId: orderId,
          externalCustomerName: customerName.trim(),
          externalCustomerPhone: customerPhone,
          items,
          subtotal,
          tax,
          deliveryFee,
          tip,
          total,
          specialInstructions,
          estimatedPickupAt: estimatedPickup,
          rawPayload: orderData,
        })

        if (result.isDuplicate) {
          return NextResponse.json({ received: true, duplicate: true })
        }

        // Auto-accept if configured
        let posOrderId: string | null = null
        if (location.autoAccept) {
          posOrderId = await createPosOrderFromDelivery({
            thirdPartyOrderId: result.id,
            platform: 'ubereats',
            locationId,
            taxRate: location.defaultTaxRate,
            customerName: customerName.trim() || undefined,
            customerPhone: customerPhone || undefined,
            deliveryAddress: deliveryAddress || undefined,
            specialInstructions: specialInstructions || undefined,
            deliveryFee,
          }, items)

          // Fix 2: Confirm with UberEats after auto-accept creates POS order
          if (posOrderId) {
            void confirmWithPlatform('ubereats', orderId, locationId).catch(console.error)
          }
        }

        dispatchDeliveryEvent(locationId, 'delivery:new-order', {
          thirdPartyOrderId: result.id,
          platform: 'ubereats',
          customerName: customerName.trim(),
          total,
          status: location.autoAccept ? 'accepted' : 'received',
          posOrderId,
        })

        break
      }

      case 'orders.cancel':
      case 'order.cancelled': {
        const cancelOrderId = String(payload.order_id || meta.resource_id || '')
        const statusResult = await updateThirdPartyOrderStatus(locationId, 'ubereats', cancelOrderId, 'cancelled')

        // Fix 3: Void linked POS order when platform cancels
        if (statusResult) {
          void voidLinkedPosOrder(statusResult.id, locationId, 'ubereats').catch(console.error)
        }

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          platform: 'ubereats',
          externalOrderId: cancelOrderId,
          status: 'cancelled',
        })
        break
      }

      case 'orders.delivery_state_changed':
      case 'delivery.status': {
        const statusOrderId = String(payload.order_id || '')
        const deliveryState = String(payload.current_state || payload.status || '')

        let mappedStatus = deliveryState
        if (deliveryState === 'en_route_to_pickup' || deliveryState === 'arrived_at_pickup') {
          mappedStatus = 'preparing'
        } else if (deliveryState === 'picked_up') {
          mappedStatus = 'picked_up'
        } else if (deliveryState === 'delivered') {
          mappedStatus = 'delivered'
        }

        await updateThirdPartyOrderStatus(locationId, 'ubereats', statusOrderId, mappedStatus, {
          actualPickupAt: deliveryState === 'picked_up' ? new Date() : undefined,
        })

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          platform: 'ubereats',
          externalOrderId: statusOrderId,
          status: mappedStatus,
        })
        break
      }

      default:
        console.warn(`[ubereats/webhook] Unknown event type: ${eventType}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[ubereats/webhook] Error processing webhook:', error)
    return NextResponse.json({ received: true })
  }
}
