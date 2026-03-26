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
  confirmWithPlatform,
  voidLinkedPosOrder,
} from '@/lib/delivery/webhook-helpers'
import { normalizeGrubhubItems } from '@/lib/delivery/order-mapper'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('webhooks-grubhub')

// ── Fix 10: Comprehensive delivery status mapping ──
const GRUBHUB_DELIVERY_STATUS_MAP: Record<string, string> = {
  'driver_assigned': 'driver_assigned',
  'driver_at_restaurant': 'driver_arrived_pickup',
  'picked_up': 'picked_up',
  'driver_picked_up': 'picked_up',
  'en_route_to_customer': 'driver_en_route_dropoff',
  'approaching_customer': 'driver_arrived_dropoff',
  'delivered': 'delivered',
  'cancelled': 'cancelled',
}

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

  // ── Fix 8: Fail closed on missing secret ──
  const signature = request.headers.get('x-grubhub-signature')
    || request.headers.get('x-signature')
  if (!location.webhookSecret) {
    console.error('[grubhub/webhook] CRITICAL: No webhookSecret configured — rejecting request.', location.locationId)
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 })
  } else if (!validateHmacSignature(rawBody, signature, location.webhookSecret)) {
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

        // Parse delivery address from Grubhub order
        const addressObj = (orderData.delivery_address || orderData.address || customer.address || {}) as Record<string, unknown>
        const deliveryAddress = addressObj.formatted_address
          ? String(addressObj.formatted_address)
          : [
              addressObj.street || addressObj.address_1 || '',
              addressObj.unit || addressObj.address_2 || '',
              addressObj.city || '',
              addressObj.state || '',
              addressObj.zip || addressObj.zip_code || '',
            ].filter(Boolean).join(', ') || ''

        const items = normalizeGrubhubItems(orderData)

        const subtotal = Number(orderData.subtotal || 0) / 100
        const tax = Number(orderData.tax || 0) / 100
        const deliveryFee = Number(orderData.delivery_fee || 0) / 100

        // Fix 9: Use ?? instead of || so that a tip value of 0 isn't skipped
        // Grubhub may send separate restaurant tip and driver tip
        const restaurantTip = Number(orderData.tip ?? 0) / 100
        const driverTip = Number(orderData.driver_tip ?? 0) / 100
        const tip = restaurantTip + driverTip  // Store combined tip

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
          posOrderId = await createPosOrderFromDelivery({
            thirdPartyOrderId: result.id,
            platform: 'grubhub',
            locationId,
            taxRate: location.defaultTaxRate,
            customerName: customerName || undefined,
            customerPhone: customerPhone || undefined,
            deliveryAddress: deliveryAddress || undefined,
            specialInstructions: specialInstructions || undefined,
            deliveryFee,
          }, items)

          // Fix 6: Confirm with Grubhub after auto-accept creates POS order
          if (posOrderId) {
            void confirmWithPlatform('grubhub', externalOrderId, locationId).catch(err => log.warn({ err }, 'Background task failed'))
          }
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
        const statusResult = await updateThirdPartyOrderStatus(locationId, 'grubhub', cancelOrderId, 'cancelled')

        // Fix 7: Void linked POS order when platform cancels
        if (statusResult) {
          void voidLinkedPosOrder(statusResult.id, locationId, 'grubhub').catch(err => log.warn({ err }, 'Background task failed'))
        }

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
        const rawStatus = String(payload.delivery_status || payload.status || '')

        // Fix 10: Use comprehensive status map instead of if/else chain
        const mappedStatus = GRUBHUB_DELIVERY_STATUS_MAP[rawStatus] || rawStatus

        await updateThirdPartyOrderStatus(locationId, 'grubhub', statusOrderId, mappedStatus, {
          actualPickupAt: (rawStatus === 'picked_up' || rawStatus === 'driver_picked_up')
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
    return NextResponse.json({ received: true })
  }
}
