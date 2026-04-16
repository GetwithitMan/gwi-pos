/**
 * OrderItem Repository -- Tenant-Safe OrderItem Data Access
 *
 * Every query includes locationId in its WHERE clause to enforce tenant isolation.
 * This replaces the dangerous pattern of `db.orderItem.findUnique({ where: { id } })`
 * which has no tenant guard and could leak data across locations.
 *
 * Usage:
 *   import { OrderItemRepository } from '@/lib/repositories'
 *   const item = await OrderItemRepository.getItemById(id, locationId)
 *   const item = await OrderItemRepository.getItemByIdOrThrow(id, locationId, tx)
 */

import { getClient, type TxClient } from './base-repository'
import type { Prisma } from '@/generated/prisma/client'

// ── Common Include Shapes ────────────────────────────────────────────────

/** Modifiers include -- non-deleted modifiers only. */
const MODIFIERS_INCLUDE = {
  modifiers: { where: { deletedAt: null } },
} satisfies Prisma.OrderItemInclude

/** Full item include -- modifiers + ingredient mods + pizza data + item discounts + combo selections.
 *  Aligned with ORDER_ITEM_FULL_INCLUDE in @/lib/domain/order-items/combo-selections.ts. */
export const FULL_ITEM_INCLUDE = {
  modifiers: { where: { deletedAt: null } },
  ingredientModifications: true,
  pizzaData: true,
  itemDiscounts: {
    where: { deletedAt: null },
    select: { id: true, amount: true, percent: true, reason: true },
  },
  // Combo Pick N of M (Migration 129) — snapshot picks, ordered for receipts/print.
  comboSelections: {
    where: { deletedAt: null },
    orderBy: { sortIndex: 'asc' as const },
    include: {
      comboComponent: true,
      comboComponentOption: true,
      menuItem: true,
    },
  },
} satisfies Prisma.OrderItemInclude

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Get an order item by ID, scoped to locationId.
 * Returns null if not found. Excludes soft-deleted items.
 */
export async function getItemById(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.findFirst({
    where: { id, locationId, deletedAt: null },
  })
}

/**
 * Get an order item by ID or throw, scoped to locationId.
 * Use this when the item MUST exist (e.g., inside a known-good transaction).
 */
export async function getItemByIdOrThrow(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const item = await client.orderItem.findFirst({
    where: { id, locationId, deletedAt: null },
  })
  if (!item) throw new Error(`OrderItem ${id} not found for location ${locationId}`)
  return item
}

/**
 * Get an order item by ID with a custom include shape.
 * Escape hatch for route handlers that need specific field sets
 * without duplicating locationId enforcement.
 */
export async function getItemByIdWithInclude<T extends Prisma.OrderItemInclude>(
  id: string,
  locationId: string,
  include: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.findFirst({
    where: { id, locationId, deletedAt: null },
    include,
  })
}

/**
 * Get all active items for an order, scoped to locationId.
 * Excludes soft-deleted items.
 */
export async function getItemsForOrder(
  orderId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.findMany({
    where: { orderId, locationId, deletedAt: null },
  })
}

/**
 * Get all active items for an order with modifiers included.
 * Excludes soft-deleted items and modifiers.
 */
export async function getItemsForOrderWithModifiers(
  orderId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.findMany({
    where: { orderId, locationId, deletedAt: null },
    include: MODIFIERS_INCLUDE,
  })
}

/**
 * Get items for an order filtered by additional where conditions.
 * locationId is always enforced; caller supplies the rest.
 */
export async function getItemsForOrderWhere(
  orderId: string,
  locationId: string,
  where: Omit<Prisma.OrderItemWhereInput, 'orderId' | 'locationId'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.findMany({
    where: { orderId, locationId, ...where },
  })
}

/**
 * Get item IDs for an order matching extra filters.
 * Lightweight -- only returns { id }.
 */
export async function getItemIdsForOrderWhere(
  orderId: string,
  locationId: string,
  where: Omit<Prisma.OrderItemWhereInput, 'orderId' | 'locationId'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.findMany({
    where: { orderId, locationId, ...where },
    select: { id: true },
  })
}

/**
 * Count active items for an order, scoped to locationId.
 */
export async function countItemsForOrder(
  orderId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.count({
    where: { orderId, locationId, deletedAt: null },
  })
}

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Update an order item, enforcing locationId in the WHERE clause.
 *
 * Uses updateMany with composite where -- returns count, never throws on not-found.
 * Throws if no matching item was found (count === 0).
 */
export async function updateItem(
  id: string,
  locationId: string,
  data: Prisma.OrderItemUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.orderItem.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`OrderItem ${id} not found for location ${locationId} -- update failed`)
  }
  return result
}

/**
 * Update an order item and return the updated record.
 *
 * Two-step: updateMany (tenant-safe) then findFirst (tenant-safe)
 * to return the full updated object. Use when you need the returned item.
 *
 * For write-only updates where you don't need the result, prefer updateItem().
 */
export async function updateItemAndReturn<T extends Prisma.OrderItemInclude>(
  id: string,
  locationId: string,
  data: Prisma.OrderItemUpdateManyMutationInput,
  include?: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.orderItem.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`OrderItem ${id} not found for location ${locationId} -- update failed`)
  }
  return client.orderItem.findFirst({
    where: { id, locationId },
    ...(include ? { include } : {}),
  })
}

/**
 * Batch update multiple order items matching a where clause, scoped to locationId.
 * Used by course operations (fire, hold, release, mark_ready, mark_served).
 *
 * Returns { count } -- the number of rows affected.
 */
export async function updateItemsWhere(
  orderId: string,
  locationId: string,
  where: Omit<Prisma.OrderItemWhereInput, 'orderId' | 'locationId'>,
  data: Prisma.OrderItemUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.updateMany({
    where: { orderId, locationId, ...where },
    data,
  })
}

/**
 * Soft-delete an order item (set deletedAt + status='removed').
 * Also soft-deletes associated modifiers.
 */
export async function softDeleteItem(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const now = new Date()

  // Soft-delete modifiers first
  await client.orderItemModifier.updateMany({
    where: { orderItemId: id },
    data: { deletedAt: now },
  })

  // Soft-delete the item
  const result = await client.orderItem.updateMany({
    where: { id, locationId },
    data: { deletedAt: now, status: 'removed' },
  })
  if (result.count === 0) {
    throw new Error(`OrderItem ${id} not found for location ${locationId} -- soft delete failed`)
  }
  return result
}

// ── Batch Operations (by ID list) ─────────────────────────────────────

/**
 * Get multiple order items by their IDs, scoped to locationId.
 * Used by KDS bump/complete/resend operations.
 */
export async function getItemsByIds(
  ids: string[],
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.findMany({
    where: { id: { in: ids }, locationId },
  })
}

/**
 * Get multiple order items by IDs with a custom select shape.
 * Lightweight variant -- only returns selected fields.
 */
export async function getItemsByIdsWithSelect<T extends Prisma.OrderItemSelect>(
  ids: string[],
  locationId: string,
  select: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.findMany({
    where: { id: { in: ids }, locationId },
    select,
  })
}

/**
 * Get multiple order items by IDs with a custom include shape.
 */
export async function getItemsByIdsWithInclude<T extends Prisma.OrderItemInclude>(
  ids: string[],
  locationId: string,
  include: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.findMany({
    where: { id: { in: ids }, locationId },
    include,
  })
}

/**
 * Batch update multiple order items by their IDs, scoped to locationId.
 * Used by KDS bump/complete/resend operations.
 *
 * Returns { count } -- the number of rows affected.
 */
export async function updateItemsByIds(
  ids: string[],
  locationId: string,
  data: Prisma.OrderItemUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.updateMany({
    where: { id: { in: ids }, locationId },
    data,
  })
}

/**
 * Get a single order item by ID with a custom select shape, scoped to locationId.
 * Lightweight -- only returns selected fields.
 */
export async function getItemByIdWithSelect<T extends Prisma.OrderItemSelect>(
  id: string,
  locationId: string,
  select: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderItem.findFirst({
    where: { id, locationId },
    select,
  })
}
