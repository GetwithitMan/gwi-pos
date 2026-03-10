/**
 * UberEats Webhook Receiver
 *
 * POST /api/webhooks/ubereats
 *
 * Receives UberEats webhook events. Validates HMAC signature.
 * Event types: orders.notification, orders.cancel
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
import { normalizeUberEatsItems } from '@/lib/delivery/order-mapper'

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

  // Validate HMAC signature
  const signature = request.headers.get('x-uber-signature')
    || request.headers.get('x-signature')
  if (location.webhookSecret && !validateHmacSignature(rawBody, signature, location.webhookSecret)) {
    console.error('[ubereats/webhook] HMAC validation failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const { locationId } = location

  try {
    switch (eventType) {
      case 'orders.notification':
      case 'order.created': {
        const orderData = (payload.order || payload) as Record<string, unknown>
        const customer = (orderData.eater || orderData.customer || {}) as Record<string, unknown>
        const customerName = String(customer.first_name || '') +
          (customer.last_name ? ` ${customer.last_name}` : '')
        const customerPhone = String(customer.phone || '')

        const items = normalizeUberEatsItems(orderData)

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
          externalOrderId,
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
            'ubereats',
            locationId,
            location.defaultTaxRate,
          )
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
        await updateThirdPartyOrderStatus(locationId, 'ubereats', cancelOrderId, 'cancelled')

        // TODO: Void linked POS order if exists (requires void API integration)

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
        console.log(`[ubereats/webhook] Unknown event type: ${eventType}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[ubereats/webhook] Error processing webhook:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
