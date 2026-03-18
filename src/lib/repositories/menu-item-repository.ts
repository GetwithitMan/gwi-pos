/**
 * MenuItem Repository -- Tenant-Safe MenuItem Data Access
 *
 * Every query includes locationId in its WHERE clause to enforce tenant isolation.
 * This replaces the dangerous pattern of `db.menuItem.findUnique({ where: { id } })`
 * which has no tenant guard and could leak data across locations.
 *
 * Usage:
 *   import { MenuItemRepository } from '@/lib/repositories'
 *   const item = await MenuItemRepository.getMenuItemById(id, locationId)
 *   const item = await MenuItemRepository.getMenuItemByIdOrThrow(id, locationId, tx)
 */

import { getClient, type TxClient } from './base-repository'
import type { Prisma } from '@/generated/prisma/client'

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Get a menu item by ID, scoped to locationId.
 * Returns null if not found. Excludes soft-deleted items.
 */
export async function getMenuItemById(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.menuItem.findFirst({
    where: { id, locationId, deletedAt: null },
  })
}

/**
 * Get a menu item by ID or throw, scoped to locationId.
 * Use this when the menu item MUST exist (e.g., inside a known-good transaction).
 */
export async function getMenuItemByIdOrThrow(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const item = await client.menuItem.findFirst({
    where: { id, locationId, deletedAt: null },
  })
  if (!item) throw new Error(`MenuItem ${id} not found for location ${locationId}`)
  return item
}

/**
 * Get a menu item by ID with a custom include shape.
 * Escape hatch for route handlers that need specific relations
 * without duplicating locationId enforcement.
 */
export async function getMenuItemByIdWithInclude<T extends Prisma.MenuItemInclude>(
  id: string,
  locationId: string,
  include: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.menuItem.findFirst({
    where: { id, locationId, deletedAt: null },
    include,
  })
}

/**
 * Get a menu item by ID with a custom select shape.
 * Useful for lightweight existence checks or single-field reads.
 */
export async function getMenuItemByIdWithSelect<T extends Prisma.MenuItemSelect>(
  id: string,
  locationId: string,
  select: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.menuItem.findFirst({
    where: { id, locationId, deletedAt: null },
    select,
  })
}

/**
 * Get all menu items for a location, with optional additional WHERE filters.
 * Excludes soft-deleted items.
 */
export async function getMenuItems(
  locationId: string,
  where?: Omit<Prisma.MenuItemWhereInput, 'locationId' | 'deletedAt'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.menuItem.findMany({
    where: { locationId, deletedAt: null, ...where },
    orderBy: { sortOrder: 'asc' },
  })
}

/**
 * Get all menu items for a specific category, scoped to locationId.
 * Excludes soft-deleted items.
 */
export async function getMenuItemsByCategory(
  categoryId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.menuItem.findMany({
    where: { categoryId, locationId, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
  })
}

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Update a menu item, enforcing locationId in the WHERE clause.
 *
 * Uses updateMany with composite where -- returns count, never throws on not-found.
 * This is safer than update() which only takes { id } in where and has no tenant guard.
 *
 * Throws if no matching menu item was found (count === 0).
 */
export async function updateMenuItem(
  id: string,
  locationId: string,
  data: Prisma.MenuItemUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.menuItem.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`MenuItem ${id} not found for location ${locationId} -- update failed`)
  }
  return result
}

/**
 * Update a menu item and return the updated record.
 *
 * Two-step: updateMany (tenant-safe) then findFirst (tenant-safe)
 * to return the full updated object.
 */
export async function updateMenuItemAndReturn(
  id: string,
  locationId: string,
  data: Prisma.MenuItemUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.menuItem.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`MenuItem ${id} not found for location ${locationId} -- update failed`)
  }
  return client.menuItem.findFirst({
    where: { id, locationId, deletedAt: null },
  })
}

/**
 * Create a menu item with locationId baked in.
 */
export async function createMenuItem(
  locationId: string,
  data: Omit<Prisma.MenuItemCreateInput, 'location'> & { categoryId: string },
  tx?: TxClient,
) {
  const client = getClient(tx)
  const { categoryId, ...rest } = data
  return client.menuItem.create({
    data: {
      ...rest,
      location: { connect: { id: locationId } },
      category: { connect: { id: categoryId } },
    },
  })
}

/**
 * Soft-delete a menu item (set deletedAt). Never hard-delete.
 */
export async function softDeleteMenuItem(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updateMenuItem(id, locationId, { deletedAt: new Date() }, tx)
}
