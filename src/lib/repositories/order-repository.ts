/**
 * Order Repository -- Tenant-Safe Order Data Access
 *
 * Every query includes locationId in its WHERE clause to enforce tenant isolation.
 * This replaces the dangerous pattern of `db.order.findUnique({ where: { id } })`
 * which has no tenant guard and could leak data across locations.
 *
 * Usage:
 *   import { OrderRepository } from '@/lib/repositories'
 *   const order = await OrderRepository.getOrderById(id, locationId)
 *   const order = await OrderRepository.getOrderByIdOrThrow(id, locationId, tx)
 */

import { getClient, type TxClient } from './base-repository'
import type { Prisma, OrderStatus } from '@/generated/prisma/client'

// ── Common Include Shapes ────────────────────────────────────────────────
// Reusable include objects for the most frequent query patterns.
// Route handlers that need custom includes should use getOrderById with
// their own select/include and the raw client, or extend these shapes.

const ORDER_ITEMS_INCLUDE = {
  where: { deletedAt: null },
  include: {
    modifiers: { where: { deletedAt: null } },
    ingredientModifications: true,
    pizzaData: true,
    menuItem: { select: { itemType: true } },
    itemDiscounts: {
      where: { deletedAt: null },
      select: { id: true, amount: true, percent: true, reason: true },
    },
  },
} satisfies Prisma.OrderItemFindManyArgs

const EMPLOYEE_SELECT = {
  select: { id: true, displayName: true, firstName: true, lastName: true },
} satisfies Prisma.EmployeeFindManyArgs

const TABLE_SELECT = {
  select: { id: true, name: true },
} satisfies Prisma.TableFindManyArgs

/** Full order include -- items + employee + table + payments. Used by GET /api/orders/[id] */
export const FULL_ORDER_INCLUDE = {
  employee: EMPLOYEE_SELECT,
  table: TABLE_SELECT,
  items: ORDER_ITEMS_INCLUDE,
  payments: {
    where: { deletedAt: null },
    select: {
      id: true,
      paymentMethod: true,
      amount: true,
      tipAmount: true,
      totalAmount: true,
      status: true,
      cardLast4: true,
      cardBrand: true,
      roundingAdjustment: true,
    },
  },
} satisfies Prisma.OrderInclude

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Get an order by ID, scoped to locationId.
 * Returns null if not found. Excludes soft-deleted orders.
 */
export async function getOrderById(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.order.findFirst({
    where: { id, locationId },
  })
}

/**
 * Get an order by ID or throw, scoped to locationId.
 * Use this when the order MUST exist (e.g., inside a known-good transaction).
 */
export async function getOrderByIdOrThrow(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const order = await client.order.findFirst({
    where: { id, locationId },
  })
  if (!order) throw new Error(`Order ${id} not found for location ${locationId}`)
  return order
}

/**
 * Get an order by ID with a custom include/select shape.
 * This is the escape hatch for route handlers that need specific field sets
 * without duplicating locationId enforcement.
 */
export async function getOrderByIdWithInclude<T extends Prisma.OrderInclude>(
  id: string,
  locationId: string,
  include: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.order.findFirst({
    where: { id, locationId },
    include,
  })
}

/**
 * Get an order by ID with a custom select shape.
 * Useful for lightweight existence checks or single-field reads.
 */
export async function getOrderByIdWithSelect<T extends Prisma.OrderSelect>(
  id: string,
  locationId: string,
  select: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.order.findFirst({
    where: { id, locationId },
    select,
  })
}

/**
 * Get a fully-loaded order (items + employee + table + payments).
 * Mirrors the current GET /api/orders/[id] default view.
 */
export async function getFullOrder(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.order.findFirst({
    where: { id, locationId },
    include: FULL_ORDER_INCLUDE,
  })
}

/**
 * Get all open (modifiable) orders for a location.
 * "Open" = draft, open, in_progress, sent, split.
 */
export async function getOpenOrders(locationId: string, tx?: TxClient) {
  const client = getClient(tx)
  return client.order.findMany({
    where: {
      locationId,
      status: { in: ['draft', 'open', 'in_progress', 'sent', 'split'] },
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Get orders by status for a location.
 * Supports single status or array of statuses.
 */
export async function getOrdersByStatus(
  locationId: string,
  status: OrderStatus | OrderStatus[],
  tx?: TxClient,
) {
  const client = getClient(tx)
  const statusFilter = Array.isArray(status) ? { in: status } : status
  return client.order.findMany({
    where: { locationId, status: statusFilter },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Get orders for a specific table that are still active (not closed/voided/cancelled).
 * Used for table occupation checks.
 */
export async function getActiveOrdersForTable(
  tableId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.order.findMany({
    where: {
      tableId,
      locationId,
      status: { in: ['draft', 'open', 'in_progress', 'sent', 'split'] },
    },
  })
}

/**
 * Get orders for a specific employee at a location.
 * Optionally filter by status.
 */
export async function getOrdersByEmployee(
  employeeId: string,
  locationId: string,
  status?: OrderStatus | OrderStatus[],
  tx?: TxClient,
) {
  const client = getClient(tx)
  const statusFilter = status
    ? (Array.isArray(status) ? { in: status } : status)
    : undefined
  return client.order.findMany({
    where: { employeeId, locationId, ...(statusFilter ? { status: statusFilter } : {}) },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Check if an order exists and belongs to this location.
 * Returns { id, status, locationId } or null. Lightweight check.
 */
export async function checkOrderExists(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.order.findFirst({
    where: { id, locationId },
    select: { id: true, status: true, locationId: true },
  })
}

/**
 * Count orders matching filters for a location.
 */
export async function countOrders(
  locationId: string,
  where?: Omit<Prisma.OrderWhereInput, 'locationId'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.order.count({
    where: { locationId, ...where },
  })
}

/**
 * Find an order by idempotency key. Used for duplicate detection on order creation.
 */
export async function getOrderByIdempotencyKey(
  idempotencyKey: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.order.findFirst({
    where: {
      idempotencyKey,
      locationId,
    },
    select: { id: true, orderNumber: true, status: true },
  })
}

/**
 * Find an order by its offline ID (used for sync deduplication).
 */
export async function getOrderByOfflineId(
  offlineId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.order.findFirst({
    where: { offlineId, locationId },
  })
}

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Update an order, enforcing locationId in the WHERE clause.
 *
 * Uses updateMany with composite where -- returns count, never throws on not-found.
 * This is safer than update() which only takes { id } in where and has no tenant guard.
 *
 * Throws if no matching order was found (count === 0).
 */
export async function updateOrder(
  id: string,
  locationId: string,
  data: Prisma.OrderUpdateManyMutationInput | Prisma.OrderUncheckedUpdateManyInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.order.updateMany({
    where: { id, locationId },
    data: data as Prisma.OrderUpdateManyMutationInput,
  })
  if (result.count === 0) {
    throw new Error(`Order ${id} not found for location ${locationId} -- update failed`)
  }
  return result
}

/**
 * Update an order and return the updated record with includes.
 *
 * This does a two-step: updateMany (tenant-safe) then findFirst (tenant-safe)
 * to return the full updated object. Use this when you need the returned order.
 *
 * For write-only updates where you don't need the result, prefer updateOrder().
 */
export async function updateOrderAndReturn<T extends Prisma.OrderInclude>(
  id: string,
  locationId: string,
  data: Prisma.OrderUpdateManyMutationInput | Prisma.OrderUncheckedUpdateManyInput,
  include?: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.order.updateMany({
    where: { id, locationId },
    data: data as Prisma.OrderUpdateManyMutationInput,
  })
  if (result.count === 0) {
    throw new Error(`Order ${id} not found for location ${locationId} -- update failed`)
  }
  return client.order.findFirst({
    where: { id, locationId },
    ...(include ? { include } : {}),
  })
}

/**
 * Update an order and return it with a custom select shape.
 * Lighter-weight than updateOrderAndReturn when you only need a few fields.
 */
export async function updateOrderAndSelect<T extends Prisma.OrderSelect>(
  id: string,
  locationId: string,
  data: Prisma.OrderUpdateManyMutationInput | Prisma.OrderUncheckedUpdateManyInput,
  select: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.order.updateMany({
    where: { id, locationId },
    data: data as Prisma.OrderUpdateManyMutationInput,
  })
  if (result.count === 0) {
    throw new Error(`Order ${id} not found for location ${locationId} -- update failed`)
  }
  return client.order.findFirst({
    where: { id, locationId },
    select,
  })
}

/**
 * Increment the order version (optimistic concurrency control).
 * Used after item mutations to signal the order changed.
 */
export async function incrementVersion(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updateOrder(id, locationId, { version: { increment: 1 } }, tx)
}

/**
 * Soft-delete an order (set deletedAt). Never hard-delete.
 */
export async function softDeleteOrder(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updateOrder(id, locationId, { deletedAt: new Date() }, tx)
}

/**
 * Close an order -- set status + closedAt + version bump.
 * Use for paid, closed, voided, cancelled terminal states.
 */
export async function closeOrder(
  id: string,
  locationId: string,
  status: 'paid' | 'closed' | 'voided' | 'cancelled',
  tx?: TxClient,
) {
  return updateOrder(
    id,
    locationId,
    {
      status,
      closedAt: new Date(),
      paidAt: status === 'paid' ? new Date() : undefined,
      version: { increment: 1 },
    },
    tx,
  )
}

/**
 * Update order totals after item changes.
 * Accepts the pre-calculated totals from calculateOrderTotals().
 */
export async function updateOrderTotals(
  id: string,
  locationId: string,
  totals: {
    subtotal: number
    taxTotal: number
    taxFromInclusive: number
    taxFromExclusive: number
    total: number
    discountTotal?: number
    commissionTotal?: number
    tipTotal?: number
    itemCount?: number
  },
  tx?: TxClient,
) {
  return updateOrder(
    id,
    locationId,
    {
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      taxFromInclusive: totals.taxFromInclusive,
      taxFromExclusive: totals.taxFromExclusive,
      total: totals.total,
      ...(totals.discountTotal !== undefined ? { discountTotal: totals.discountTotal } : {}),
      ...(totals.commissionTotal !== undefined ? { commissionTotal: totals.commissionTotal } : {}),
      ...(totals.tipTotal !== undefined ? { tipTotal: totals.tipTotal } : {}),
      ...(totals.itemCount !== undefined ? { itemCount: totals.itemCount } : {}),
      version: { increment: 1 },
    },
    tx,
  )
}

// ── Tab-Specific ─────────────────────────────────────────────────────────

/**
 * Get open tabs (bar tabs) for a location.
 */
export async function getOpenTabs(locationId: string, tx?: TxClient) {
  const client = getClient(tx)
  return client.order.findMany({
    where: {
      locationId,
      tabStatus: { not: null },
      status: { in: ['draft', 'open', 'in_progress', 'sent'] },
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Get open tabs for a specific employee.
 */
export async function getEmployeeOpenTabs(
  employeeId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.order.findMany({
    where: {
      employeeId,
      locationId,
      tabStatus: { not: null },
      status: { in: ['draft', 'open', 'in_progress', 'sent'] },
    },
    orderBy: { createdAt: 'desc' },
  })
}

// ── Pre-Auth ─────────────────────────────────────────────────────────────

/**
 * Update pre-auth fields on an order (after card hold).
 */
export async function setPreAuth(
  id: string,
  locationId: string,
  preAuth: {
    preAuthId: string
    preAuthAmount: number
    preAuthLast4?: string
    preAuthCardBrand?: string
    preAuthExpiresAt?: Date
    preAuthRecordNo?: string
    preAuthReaderId?: string
  },
  tx?: TxClient,
) {
  return updateOrder(id, locationId, preAuth as Prisma.OrderUpdateManyMutationInput, tx)
}

/**
 * Clear pre-auth fields (after capture or void).
 */
export async function clearPreAuth(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updateOrder(
    id,
    locationId,
    {
      preAuthId: null,
      preAuthAmount: null,
      preAuthLast4: null,
      preAuthCardBrand: null,
      preAuthExpiresAt: null,
      preAuthRecordNo: null,
    },
    tx,
  )
}

// ── Walkout ──────────────────────────────────────────────────────────────

/**
 * Mark an order as a walkout.
 */
export async function markWalkout(
  id: string,
  locationId: string,
  markedBy: string,
  tx?: TxClient,
) {
  return updateOrder(
    id,
    locationId,
    {
      isWalkout: true,
      walkoutAt: new Date(),
      walkoutMarkedBy: markedBy,
    },
    tx,
  )
}

// ── Reopen ───────────────────────────────────────────────────────────────

/**
 * Reopen a closed order.
 */
export async function reopenOrder(
  id: string,
  locationId: string,
  reopenedBy: string,
  reason?: string,
  tx?: TxClient,
) {
  return updateOrder(
    id,
    locationId,
    {
      status: 'open',
      closedAt: null,
      paidAt: null,
      reopenedAt: new Date(),
      reopenedBy,
      reopenReason: reason ?? null,
      version: { increment: 1 },
    },
    tx,
  )
}
