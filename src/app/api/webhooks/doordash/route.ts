/**
 * DoorDash Webhook Receiver
 *
 * POST /api/webhooks/doordash
 *
 * Receives DoorDash webhook events. Validates HMAC signature.
 * Event types: ORDER_CREATED, ORDER_CANCELLED, DELIVERY_STATUS_UPDATE
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

  const eventType = String(payload.event_type || payload.type || '')
  const storeId = String(payload.store_id || payload.merchant_id || '')
  const externalOrderId = String(payload.order_id || payload.delivery_id || '')

  // Resolve location by storeId
  const location = await resolveLocationForWebhook('doordash', storeId || null)
  if (!location) {
    console.error('[doordash/webhook] No matching location for storeId:', storeId)
    // Return 200 to prevent retry storms
    return NextResponse.json({ received: true })
  }

  // Validate HMAC signature
  const signature = request.headers.get('x-doordash-signature')
    || request.headers.get('x-signature')
  if (!location.webhookSecret) {
    console.error('[doordash/webhook] No webhookSecret configured for location', location.locationId)
    return NextResponse.json({ error: 'Webhook secret not configured for this location' }, { status: 401 })
  }
  if (!validateHmacSignature(rawBody, signature, location.webhookSecret)) {
    console.error('[doordash/webhook] HMAC validation failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const { locationId } = location

  try {
    switch (eventType) {
      case 'ORDER_CREATED':
      case 'order.created': {
        const orderData = (payload.order || payload) as Record<string, unknown>
        const customerName = String(orderData.customer_name || orderData.first_name || '')
        const customerPhone = String(orderData.customer_phone || '')
        const items = normalizeDoorDashItems(orderData)

        const subtotal = Number(orderData.subtotal || 0) / 100  // cents → dollars
        const tax = Number(orderData.tax || 0) / 100
        const deliveryFee = Number(orderData.delivery_fee || 0) / 100
        const tip = Number(orderData.tip || 0) / 100
        const total = Number(orderData.total || 0) / 100

        const specialInstructions = String(orderData.special_instructions || '')
        const estimatedPickup = orderData.estimated_pickup_time
          ? new Date(String(orderData.estimated_pickup_time))
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

      case 'ORDER_CANCELLED':
      case 'order.cancelled': {
        const cancelOrderId = String(payload.order_id || '')
        await updateThirdPartyOrderStatus(locationId, 'doordash', cancelOrderId, 'cancelled')

        // TODO: Void linked POS order if exists (requires void API integration)

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          platform: 'doordash',
          externalOrderId: cancelOrderId,
          status: 'cancelled',
        })
        break
      }

      case 'DELIVERY_STATUS_UPDATE':
      case 'delivery.status_update': {
        const statusOrderId = String(payload.order_id || '')
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
        console.warn(`[doordash/webhook] Unknown event type: ${eventType}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[doordash/webhook] Error processing webhook:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
