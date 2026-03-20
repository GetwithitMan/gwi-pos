/**
 * DoorDash Webhook Receiver
 *
 * POST /api/webhooks/doordash
 *
 * Receives DoorDash webhook events. Validates HMAC signature.
 * Event types: OrderCreate, OrderCancel (new v2) + ORDER_CREATED, ORDER_CANCELLED (legacy)
 *
 * No auth (public endpoint) — validated by HMAC signature from webhookSecret.
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
import { normalizeDoorDashItems } from '@/lib/delivery/order-mapper'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ── Parse event type from DoorDash v2 structure ─────────────────────────
  // DoorDash v2: { event: { type: "OrderCreate" }, order: { id, store: { merchant_supplied_id }, ... } }
  // Legacy:      { event_type: "ORDER_CREATED", order_id: "...", store_id: "..." }
  const eventObj = payload.event as Record<string, unknown> | undefined
  const eventType = String(
    eventObj?.type || payload.event_type || payload.type || '',
  )

  // ── Parse order + store from v2 nested structure ────────────────────────
  const orderObj = (payload.order || {}) as Record<string, unknown>
  const storeObj = (orderObj.store || {}) as Record<string, unknown>
  const storeId = String(
    storeObj.merchant_supplied_id || payload.store_id || payload.merchant_id || '',
  )
  const externalOrderId = String(
    orderObj.id || payload.order_id || payload.delivery_id || '',
  )

  // ── Parse customer from v2 nested structure ─────────────────────────────
  const customerObj = (orderObj.customer || {}) as Record<string, unknown>
  const customerFirstName = String(customerObj.first_name || '')
  const customerLastName = String(customerObj.last_name || '')
  const customerName = String(
    orderObj.customer_name
    || (customerFirstName ? `${customerFirstName} ${customerLastName}`.trim() : '')
    || '',
  )
  const customerPhone = String(
    customerObj.phone_number || orderObj.customer_phone || '',
  )

  // Resolve location by storeId
  const location = await resolveLocationForWebhook('doordash', storeId || null)
  if (!location) {
    console.error('[doordash-webhook] No matching location for storeId:', storeId)
    // Return 200 to prevent retry storms
    return NextResponse.json({ received: true })
  }

  // Validate HMAC signature — FAIL CLOSED if secret not configured
  const signature = request.headers.get('x-doordash-signature')
    || request.headers.get('x-signature')
  if (!location.webhookSecret) {
    console.error('[doordash-webhook] CRITICAL: webhookSecret not configured — rejecting')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 })
  } else if (!validateHmacSignature(rawBody, signature, location.webhookSecret)) {
    console.error('[doordash-webhook] HMAC validation failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const { locationId } = location

  try {
    switch (eventType) {
      // ── New order ─────────────────────────────────────────────────────
      case 'OrderCreate':
      case 'ORDER_CREATED':
      case 'order.created': {
        // normalizeDoorDashItems handles the full payload (flattens categories[].items[])
        const items = normalizeDoorDashItems(payload)

        const subtotal = Number(orderObj.subtotal || 0) / 100  // cents → dollars
        const tax = Number(orderObj.tax || 0) / 100
        const deliveryFee = Number(orderObj.delivery_fee || 0) / 100
        const tip = Number(orderObj.tip || 0) / 100
        const total = Number(orderObj.total || 0) / 100

        const specialInstructions = String(orderObj.special_instructions || '')
        const estimatedPickup = orderObj.estimated_pickup_time
          ? new Date(String(orderObj.estimated_pickup_time))
          : undefined

        const result = await createThirdPartyOrder({
          locationId,
          platform: 'doordash',
          externalOrderId,
          externalCustomerName: customerName,
          externalCustomerPhone: customerPhone,
          items,
          subtotal,
          tax,
          deliveryFee,
          tip,
          total,
          specialInstructions,
          estimatedPickupAt: estimatedPickup,
          rawPayload: payload,
        })

        if (result.isDuplicate) {
          return NextResponse.json({ received: true, duplicate: true })
        }

        // Auto-accept if configured
        let posOrderId: string | null = null
        if (location.autoAccept) {
          posOrderId = await createPosOrderFromDelivery(
            result.id,
            items,
            'doordash',
            locationId,
            location.defaultTaxRate,
          )

          // Confirm with DoorDash after POS order is created
          if (posOrderId) {
            void confirmWithPlatform('doordash', externalOrderId, locationId).catch(console.error)
          }
        }

        // Socket: new order notification
        dispatchDeliveryEvent(locationId, 'delivery:new-order', {
          thirdPartyOrderId: result.id,
          platform: 'doordash',
          customerName,
          total,
          status: location.autoAccept ? 'accepted' : 'received',
          posOrderId,
        })

        break
      }

      // ── Order cancelled ───────────────────────────────────────────────
      case 'OrderCancel':
      case 'ORDER_CANCELLED':
      case 'order.cancelled': {
        const cancelOrderId = externalOrderId || String(payload.order_id || '')
        const updateResult = await updateThirdPartyOrderStatus(locationId, 'doordash', cancelOrderId, 'cancelled')

        // Void linked POS order if exists
        if (updateResult?.id) {
          void voidLinkedPosOrder(updateResult.id, locationId, 'doordash').catch(console.error)
        }

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          platform: 'doordash',
          externalOrderId: cancelOrderId,
          status: 'cancelled',
        })
        break
      }

      // ── Delivery status update ────────────────────────────────────────
      case 'DELIVERY_STATUS_UPDATE':
      case 'delivery.status_update': {
        const statusOrderId = externalOrderId || String(payload.order_id || '')
        const deliveryStatus = String(payload.delivery_status || payload.status || '')

        // Map DoorDash delivery statuses to our status
        let mappedStatus = deliveryStatus
        if (deliveryStatus === 'dasher_confirmed' || deliveryStatus === 'dasher_at_store') {
          mappedStatus = 'preparing'
        } else if (deliveryStatus === 'order_picked_up') {
          mappedStatus = 'picked_up'
        } else if (deliveryStatus === 'delivered') {
          mappedStatus = 'delivered'
        }

        await updateThirdPartyOrderStatus(locationId, 'doordash', statusOrderId, mappedStatus, {
          actualPickupAt: deliveryStatus === 'order_picked_up' ? new Date() : undefined,
        })

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          platform: 'doordash',
          externalOrderId: statusOrderId,
          status: mappedStatus,
        })
        break
      }

      default:
        // Unknown event type — log but don't error
        console.warn(`[doordash-webhook] Unknown event type: ${eventType}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[doordash-webhook] Error processing webhook:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
