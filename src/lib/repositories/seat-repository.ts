/**
 * Seat Repository -- Tenant-Safe Seat Data Access
 *
 * Every query includes locationId in its WHERE clause to enforce tenant isolation.
 * This replaces the dangerous pattern of `db.seat.findUnique({ where: { id } })`
 * which has no tenant guard and could leak data across locations.
 *
 * Usage:
 *   import { SeatRepository } from '@/lib/repositories'
 *   const seat = await SeatRepository.getSeatById(id, locationId)
 *   const seats = await SeatRepository.getSeatsForTable(tableId, locationId)
 */

import { getClient, type TxClient } from './base-repository'
import type { Prisma } from '@/generated/prisma/client'

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Get a seat by ID, scoped to locationId.
 * Returns null if not found. Excludes soft-deleted seats.
 */
export async function getSeatById(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.seat.findFirst({
    where: { id, locationId, deletedAt: null },
  })
}

/**
 * Get all seats for a table, scoped to locationId.
 * Excludes soft-deleted seats. Ordered by seatNumber.
 */
export async function getSeatsForTable(
  tableId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.seat.findMany({
    where: { tableId, locationId, deletedAt: null },
    orderBy: { seatNumber: 'asc' },
  })
}

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Create a seat with locationId baked in.
 */
export async function createSeat(
  locationId: string,
  data: Omit<Prisma.SeatCreateInput, 'location' | 'table'> & { tableId: string },
  tx?: TxClient,
) {
  const client = getClient(tx)
  const { tableId, ...rest } = data
  return client.seat.create({
    data: {
      ...rest,
      location: { connect: { id: locationId } },
      table: { connect: { id: tableId } },
    },
  })
}

/**
 * Update a seat, enforcing locationId in the WHERE clause.
 *
 * Uses updateMany with composite where -- returns count, never throws on not-found.
 * This is safer than update() which only takes { id } in where and has no tenant guard.
 *
 * Throws if no matching seat was found (count === 0).
 */
export async function updateSeat(
  id: string,
  locationId: string,
  data: Prisma.SeatUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.seat.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`Seat ${id} not found for location ${locationId} -- update failed`)
  }
  return result
}

/**
 * Delete a seat (soft-delete via deletedAt), enforcing locationId in the WHERE clause.
 */
export async function deleteSeat(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updateSeat(id, locationId, { deletedAt: new Date() }, tx)
}
