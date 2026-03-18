/**
 * LocationId Bootstrap Helpers
 *
 * Lightweight lookups to resolve locationId from an entity ID.
 * Used at the top of route handlers before repository methods can be called.
 *
 * These use adminDb (no tenant scoping) because locationId is unknown at this point.
 * The result is used to scope all subsequent repository calls.
 *
 * adminDb has soft-delete filtering (deletedAt: null is auto-injected) but
 * we include it explicitly in each query for clarity and defensive coding.
 */

import { adminDb } from '@/lib/db'

// ── Order ──────────────────────────────────────────────────────────────────

/**
 * Resolve locationId from an order ID.
 * Returns null if order doesn't exist or is soft-deleted.
 */
export async function resolveOrderLocationId(orderId: string): Promise<string | null> {
  const row = await adminDb.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { locationId: true },
  })
  return row?.locationId ?? null
}

/**
 * Resolve locationId from an order ID, throwing if not found.
 */
export async function resolveOrderLocationIdOrThrow(orderId: string): Promise<string> {
  const locationId = await resolveOrderLocationId(orderId)
  if (!locationId) throw new Error(`Order ${orderId} not found`)
  return locationId
}

// ── Employee ───────────────────────────────────────────────────────────────

/**
 * Resolve locationId from an employee ID.
 * Returns null if employee doesn't exist or is soft-deleted.
 */
export async function resolveEmployeeLocationId(employeeId: string): Promise<string | null> {
  const row = await adminDb.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    select: { locationId: true },
  })
  return row?.locationId ?? null
}

/**
 * Resolve locationId from an employee ID, throwing if not found.
 */
export async function resolveEmployeeLocationIdOrThrow(employeeId: string): Promise<string> {
  const locationId = await resolveEmployeeLocationId(employeeId)
  if (!locationId) throw new Error(`Employee ${employeeId} not found`)
  return locationId
}

// ── MenuItem ───────────────────────────────────────────────────────────────

/**
 * Resolve locationId from a menu item ID.
 * Returns null if menu item doesn't exist or is soft-deleted.
 */
export async function resolveMenuItemLocationId(menuItemId: string): Promise<string | null> {
  const row = await adminDb.menuItem.findFirst({
    where: { id: menuItemId, deletedAt: null },
    select: { locationId: true },
  })
  return row?.locationId ?? null
}

/**
 * Resolve locationId from a menu item ID, throwing if not found.
 */
export async function resolveMenuItemLocationIdOrThrow(menuItemId: string): Promise<string> {
  const locationId = await resolveMenuItemLocationId(menuItemId)
  if (!locationId) throw new Error(`MenuItem ${menuItemId} not found`)
  return locationId
}

// ── Payment ────────────────────────────────────────────────────────────────

/**
 * Resolve locationId from a payment ID.
 * Returns null if payment doesn't exist or is soft-deleted.
 */
export async function resolvePaymentLocationId(paymentId: string): Promise<string | null> {
  const row = await adminDb.payment.findFirst({
    where: { id: paymentId, deletedAt: null },
    select: { locationId: true },
  })
  return row?.locationId ?? null
}

/**
 * Resolve locationId from a payment ID, throwing if not found.
 */
export async function resolvePaymentLocationIdOrThrow(paymentId: string): Promise<string> {
  const locationId = await resolvePaymentLocationId(paymentId)
  if (!locationId) throw new Error(`Payment ${paymentId} not found`)
  return locationId
}

// ── OrderItem ──────────────────────────────────────────────────────────────

/**
 * Resolve locationId from an order item ID.
 * Returns null if order item doesn't exist or is soft-deleted.
 */
export async function resolveOrderItemLocationId(orderItemId: string): Promise<string | null> {
  const row = await adminDb.orderItem.findFirst({
    where: { id: orderItemId, deletedAt: null },
    select: { locationId: true },
  })
  return row?.locationId ?? null
}

/**
 * Resolve locationId from an order item ID, throwing if not found.
 */
export async function resolveOrderItemLocationIdOrThrow(orderItemId: string): Promise<string> {
  const locationId = await resolveOrderItemLocationId(orderItemId)
  if (!locationId) throw new Error(`OrderItem ${orderItemId} not found`)
  return locationId
}
