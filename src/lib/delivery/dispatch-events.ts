/**
 * Delivery socket dispatch helpers.
 *
 * All events are fire-and-forget. Callers should wrap with:
 *   void dispatchXxx(locationId, payload).catch((err) => log.error({ err }, 'dispatchXxx failed'))
 *
 * Events emitted:
 *   delivery:status_changed  — structured status change (new)
 *   delivery:updated         — legacy backward-compat event
 *   delivery:driver_assigned — driver assigned to a delivery order
 *   delivery:order_reassigned — run reassigned to a different driver
 *   delivery:tip_reallocated — tip moved between drivers/holding
 *   delivery:run_created     — run dispatched / in_progress
 *   delivery:run_completed   — run reached terminal state
 *   driver:status_changed    — driver session state change
 *   driver:location_update   — GPS ping from driver device
 *   delivery:exception_created / delivery:exception_resolved
 */

import { emitToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('delivery')

// ── Delivery Order Events ───────────────────────────────────────────────────

export async function dispatchDeliveryStatusChanged(
  locationId: string,
  deliveryOrder: any,
): Promise<void> {
  // Structured event — new consumers should use this
  await emitToLocation(locationId, 'delivery:status_changed', {
    deliveryOrderId: deliveryOrder.id,
    orderId: deliveryOrder.orderId,
    status: deliveryOrder.status,
    driverId: deliveryOrder.driverId,
    runId: deliveryOrder.runId,
    updatedAt: deliveryOrder.updatedAt,
  })

  // Legacy event for backward compat with existing POS screens
  await emitToLocation(locationId, 'delivery:updated', {
    deliveryOrderId: deliveryOrder.id,
    orderId: deliveryOrder.orderId,
    status: deliveryOrder.status,
  })
}

// ── Driver Assignment Events ────────────────────────────────────────────────

export async function dispatchDriverAssigned(
  locationId: string,
  data: {
    deliveryOrderId: string
    orderId?: string | null
    driverId: string
    driverName?: string | null
  },
): Promise<void> {
  await emitToLocation(locationId, 'delivery:driver_assigned', data)
}

export async function dispatchOrderReassigned(
  locationId: string,
  data: {
    runId: string
    oldDriverId: string
    newDriverId: string
    oldDriverName?: string | null
    newDriverName?: string | null
    reason?: string
  },
): Promise<void> {
  await emitToLocation(locationId, 'delivery:order_reassigned', data)
}

export async function dispatchTipReallocated(
  locationId: string,
  data: {
    deliveryOrderId: string
    orderId: string
    fromEmployeeId: string
    toEmployeeId: string
    amountCents: number
  },
): Promise<void> {
  await emitToLocation(locationId, 'delivery:tip_reallocated', data)
}

// ── Run Events ──────────────────────────────────────────────────────────────

export async function dispatchRunEvent(
  locationId: string,
  event: string,
  run: any,
): Promise<void> {
  await emitToLocation(locationId, event, {
    runId: run.id,
    driverId: run.driverId,
    status: run.status,
    orderSequence: run.orderSequence,
    updatedAt: run.updatedAt,
  })
}

// ── Driver Events ───────────────────────────────────────────────────────────

export async function dispatchDriverStatusChanged(
  locationId: string,
  session: any,
): Promise<void> {
  await emitToLocation(locationId, 'driver:status_changed', {
    sessionId: session.id,
    employeeId: session.employeeId,
    driverId: session.driverId,
    status: session.status,
    lastLocationLat: session.lastLocationLat,
    lastLocationLng: session.lastLocationLng,
  })
}

export async function dispatchDriverLocationUpdate(
  locationId: string,
  data: {
    driverId: string
    lat: number
    lng: number
    accuracy?: number
    speed?: number
    recordedAt: string
  },
): Promise<void> {
  await emitToLocation(locationId, 'driver:location_update', data)
}

// ── Exception Events ────────────────────────────────────────────────────────

export async function dispatchExceptionEvent(
  locationId: string,
  event: 'delivery:exception_created' | 'delivery:exception_resolved',
  exception: any,
): Promise<void> {
  await emitToLocation(locationId, event, {
    exceptionId: exception.id,
    deliveryOrderId: exception.deliveryOrderId,
    runId: exception.runId,
    driverId: exception.driverId,
    type: exception.type,
    severity: exception.severity,
    status: exception.status,
  })
}
