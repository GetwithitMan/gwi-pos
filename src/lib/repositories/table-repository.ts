/**
 * Table Repository -- Tenant-Safe Table Data Access
 *
 * Every query includes locationId in its WHERE clause to enforce tenant isolation.
 * This replaces the dangerous pattern of `db.table.findUnique({ where: { id } })`
 * which has no tenant guard and could leak data across locations.
 *
 * Usage:
 *   import { TableRepository } from '@/lib/repositories'
 *   const table = await TableRepository.getTableById(id, locationId)
 *   const table = await TableRepository.getTableByIdOrThrow(id, locationId, tx)
 */

import { getClient, type TxClient } from './base-repository'
import type { Prisma, TableStatus } from '@/generated/prisma/client'

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Get a table by ID, scoped to locationId.
 * Returns null if not found. Excludes soft-deleted tables.
 */
export async function getTableById(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.table.findFirst({
    where: { id, locationId, deletedAt: null },
  })
}

/**
 * Get a table by ID or throw, scoped to locationId.
 * Use this when the table MUST exist (e.g., inside a known-good transaction).
 */
export async function getTableByIdOrThrow(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const table = await client.table.findFirst({
    where: { id, locationId, deletedAt: null },
  })
  if (!table) throw new Error(`Table ${id} not found for location ${locationId}`)
  return table
}

/**
 * Get a table by ID with a custom include shape.
 * Escape hatch for route handlers that need specific relations
 * without duplicating locationId enforcement.
 */
export async function getTableByIdWithInclude<T extends Prisma.TableInclude>(
  id: string,
  locationId: string,
  include: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.table.findFirst({
    where: { id, locationId, deletedAt: null },
    include,
  })
}

/**
 * Get all tables for a location.
 * Excludes soft-deleted tables.
 */
export async function getTablesForLocation(locationId: string, tx?: TxClient) {
  const client = getClient(tx)
  return client.table.findMany({
    where: { locationId, deletedAt: null },
    orderBy: { name: 'asc' },
  })
}

/**
 * Get tables by section for a location.
 * Excludes soft-deleted tables.
 */
export async function getTablesBySection(
  sectionId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.table.findMany({
    where: { sectionId, locationId, deletedAt: null },
    orderBy: { name: 'asc' },
  })
}

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Update a table, enforcing locationId in the WHERE clause.
 *
 * Uses updateMany with composite where -- returns count, never throws on not-found.
 * This is safer than update() which only takes { id } in where and has no tenant guard.
 *
 * Throws if no matching table was found (count === 0).
 */
export async function updateTable(
  id: string,
  locationId: string,
  data: Prisma.TableUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.table.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`Table ${id} not found for location ${locationId} -- update failed`)
  }
  return result
}

/**
 * Update a table's status, enforcing locationId in the WHERE clause.
 * Convenience wrapper for the most common table mutation.
 */
export async function updateTableStatus(
  id: string,
  locationId: string,
  status: TableStatus,
  tx?: TxClient,
) {
  return updateTable(id, locationId, { status }, tx)
}
