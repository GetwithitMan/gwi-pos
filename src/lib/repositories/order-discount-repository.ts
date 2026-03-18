/**
 * OrderDiscount Repository -- Tenant-Safe Order Discount Data Access
 *
 * Every query includes locationId in its WHERE clause to enforce tenant isolation.
 * This replaces the dangerous pattern of `db.orderDiscount.findUnique({ where: { id } })`
 * which has no tenant guard and could leak data across locations.
 *
 * Usage:
 *   import { OrderDiscountRepository } from '@/lib/repositories'
 *   const discount = await OrderDiscountRepository.getDiscountById(id, locationId)
 *   const discounts = await OrderDiscountRepository.getDiscountsForOrder(orderId, locationId, tx)
 */

import { getClient, type TxClient } from './base-repository'
import type { Prisma } from '@/generated/prisma/client'

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Get a discount by ID, scoped to locationId.
 * Returns null if not found. Excludes soft-deleted discounts.
 */
export async function getDiscountById(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderDiscount.findFirst({
    where: { id, locationId, deletedAt: null },
  })
}

/**
 * Get all non-deleted discounts for an order, scoped to locationId.
 * Returns discounts ordered by createdAt (oldest first).
 */
export async function getDiscountsForOrder(
  orderId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderDiscount.findMany({
    where: { orderId, locationId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * Get automatic discounts for an order (isAutomatic = true).
 * Used for re-evaluation when order items change.
 */
export async function getAutoDiscountsForOrder(
  orderId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderDiscount.findMany({
    where: { orderId, locationId, isAutomatic: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
}

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Create a discount with locationId baked in.
 */
export async function createDiscount(
  locationId: string,
  data: Omit<Prisma.OrderDiscountCreateInput, 'location'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderDiscount.create({
    data: {
      ...data,
      location: { connect: { id: locationId } },
    },
  })
}

/**
 * Update a discount, enforcing locationId in the WHERE clause.
 *
 * Uses updateMany with composite where -- returns count, never throws on not-found.
 * This is safer than update() which only takes { id } in where and has no tenant guard.
 *
 * Throws if no matching discount was found (count === 0).
 */
export async function updateDiscount(
  id: string,
  locationId: string,
  data: Prisma.OrderDiscountUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.orderDiscount.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`OrderDiscount ${id} not found for location ${locationId} -- update failed`)
  }
  return result
}

/**
 * Soft-delete a discount (set deletedAt). Never hard-delete.
 */
export async function softDeleteDiscount(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updateDiscount(id, locationId, { deletedAt: new Date() }, tx)
}
