/**
 * OrderCard Repository -- Tenant-Safe Order Card Data Access
 *
 * Every query includes locationId in its WHERE clause to enforce tenant isolation.
 * This replaces the dangerous pattern of `db.orderCard.findUnique({ where: { id } })`
 * which has no tenant guard and could leak data across locations.
 *
 * Usage:
 *   import { OrderCardRepository } from '@/lib/repositories'
 *   const card = await OrderCardRepository.getCardById(id, locationId)
 *   const cards = await OrderCardRepository.getCardsForOrder(orderId, locationId, tx)
 */

import { getClient, type TxClient } from './base-repository'
import type { Prisma } from '@/generated/prisma/client'

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Get a card by ID, scoped to locationId.
 * Returns null if not found. Excludes soft-deleted cards.
 */
export async function getCardById(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderCard.findFirst({
    where: { id, locationId, deletedAt: null },
  })
}

/**
 * Get all non-deleted cards for an order, scoped to locationId.
 * Returns cards ordered by createdAt (oldest first).
 */
export async function getCardsForOrder(
  orderId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderCard.findMany({
    where: { orderId, locationId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * Get active (non-voided) cards for an order, scoped to locationId.
 * Excludes cards with status 'voided'. Used for payment processing.
 */
export async function getActiveCardsForOrder(
  orderId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderCard.findMany({
    where: { orderId, locationId, status: { not: 'voided' }, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
}

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Create a card with locationId baked in.
 */
export async function createCard(
  locationId: string,
  data: Omit<Prisma.OrderCardCreateInput, 'location'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.orderCard.create({
    data: {
      ...data,
      location: { connect: { id: locationId } },
    },
  })
}

/**
 * Update a card, enforcing locationId in the WHERE clause.
 *
 * Uses updateMany with composite where -- returns count, never throws on not-found.
 * This is safer than update() which only takes { id } in where and has no tenant guard.
 *
 * Throws if no matching card was found (count === 0).
 */
export async function updateCard(
  id: string,
  locationId: string,
  data: Prisma.OrderCardUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.orderCard.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`OrderCard ${id} not found for location ${locationId} -- update failed`)
  }
  return result
}
