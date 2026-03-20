/**
 * Grubhub Webhook Receiver
 *
 * POST /api/webhooks/grubhub
 *
 * Receives Grubhub webhook events. Validates HMAC signature.
 * Event types: order.placed, order.cancelled, order.delivery_status
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
import { normalizeGrubhubItems } from '@/lib/delivery/order-mapper'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = String(payload.event_type || payload.type || '')
  const restaurantId = String(payload.restaurant_id || payload.store_id || '')
  const externalOrderId = String(payload.order_id || '')

  // Resolve location by restaurantId (stored in storeId field)
  const location = await resolveLocationForWebhook('grubhub', restaurantId || null)
  if (!location) {
    console.error('[grubhub/webhook] No matching location for restaurantId:', restaurantId)
    return NextResponse.json({ received: true })
  }

  // Validate HMAC signature
  const signature = request.headers.get('x-grubhub-signature')
    || request.headers.get('x-signature')
  if (!location.webhookSecret) {
    console.error('[grubhub/webhook] No webhookSecret configured for location', location.locationId)
    return NextResponse.json({ error: 'Webhook secret not configured for this location' }, { status: 401 })
  }
  if (!validateHmacSignature(rawBody, signature, location.webhookSecret)) {
    console.error('[grubhub/webhook] HMAC validation failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const { locationId } = location

  try {
    switch (eventType) {
      case 'order.placed':
      case 'ORDER_PLACED': {
        const orderData = (payload.order || payload) as Record<string, unknown>
        const customer = (orderData.customer || orderData.diner || {}) as Record<string, unknown>
        const customerName = String(customer.name || customer.first_name || '')
        const customerPhone = String(customer.phone || '')

        const items = normalizeGrubhubItems(orderData)

        const subtotal = Number(orderData.subtotal || 0) / 100
        const tax = Number(orderData.tax || 0) / 100
        const deliveryFee = Number(orderData.delivery_fee || 0) / 100
        const tip = Number(orderData.tip || orderData.driver_tip || 0) / 100
        const total = Number(orderData.total || 0) / 100

        const specialInstructions = String(orderData.special_instructions || orderData.notes || '')
        const estimatedPickup = orderData.estimated_pickup_time
          ? new Date(String(orderData.estimated_pickup_time))
          : undefined

        const result = await createThirdPartyOrder({
          locationId,
          platform: 'grubhub',
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
            'grubhub',
            locationId,
            location.defaultTaxRate,
          )
        }

        dispatchDeliveryEvent(locationId, 'delivery:new-order', {
          thirdPartyOrderId: result.id,
          platform: 'grubhub',
          customerName,
          total,
          status: location.autoAccept ? 'accepted' : 'received',
          posOrderId,
        })

        break
      }

      case 'order.cancelled':
      case 'ORDER_CANCELLED': {
        const cancelOrderId = String(payload.order_id || '')
        await updateThirdPartyOrderStatus(locationId, 'grubhub', cancelOrderId, 'cancelled')

        // TODO: Void linked POS order if exists (requires void API integration)

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          platform: 'grubhub',
          externalOrderId: cancelOrderId,
          status: 'cancelled',
        })
        break
      }

      case 'order.delivery_status':
      case 'DELIVERY_STATUS': {
        const statusOrderId = String(payload.order_id || '')
        const deliveryStatus = String(payload.delivery_status || payload.status || '')

        let mappedStatus = deliveryStatus
        if (deliveryStatus === 'driver_assigned' || deliveryStatus === 'driver_at_restaurant') {
          mappedStatus = 'preparing'
        } else if (deliveryStatus === 'picked_up' || deliveryStatus === 'driver_picked_up') {
          mappedStatus = 'picked_up'
        } else if (deliveryStatus === 'delivered') {
          mappedStatus = 'delivered'
        }

        await updateThirdPartyOrderStatus(locationId, 'grubhub', statusOrderId, mappedStatus, {
          actualPickupAt: (deliveryStatus === 'picked_up' || deliveryStatus === 'driver_picked_up')
            ? new Date() : undefined,
        })

        dispatchDeliveryEvent(locationId, 'delivery:status-update', {
          platform: 'grubhub',
          externalOrderId: statusOrderId,
          status: mappedStatus,
        })
        break
      }

      default:
        console.warn(`[grubhub/webhook] Unknown event type: ${eventType}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[grubhub/webhook] Error processing webhook:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
