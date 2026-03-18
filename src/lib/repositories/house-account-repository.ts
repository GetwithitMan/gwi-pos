/**
 * House Account Repository -- Tenant-Safe House Account Data Access
 *
 * Every query includes locationId in its WHERE clause to enforce tenant isolation.
 * This replaces the dangerous pattern of `db.houseAccount.findUnique({ where: { id } })`
 * which has no tenant guard and could leak data across locations.
 *
 * Usage:
 *   import { HouseAccountRepository } from '@/lib/repositories'
 *   const acct = await HouseAccountRepository.getHouseAccountById(id, locationId)
 *   const acct = await HouseAccountRepository.getHouseAccountByIdOrThrow(id, locationId, tx)
 */

import { getClient, type TxClient } from './base-repository'
import type { Prisma } from '@/generated/prisma/client'

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Get a house account by ID, scoped to locationId.
 * Returns null if not found. Excludes soft-deleted accounts.
 */
export async function getHouseAccountById(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.houseAccount.findFirst({
    where: { id, locationId, deletedAt: null },
  })
}

/**
 * Get a house account by ID or throw, scoped to locationId.
 * Use this when the account MUST exist (e.g., inside a known-good transaction).
 */
export async function getHouseAccountByIdOrThrow(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const account = await client.houseAccount.findFirst({
    where: { id, locationId, deletedAt: null },
  })
  if (!account) throw new Error(`HouseAccount ${id} not found for location ${locationId}`)
  return account
}

/**
 * Get all house accounts for a location.
 * Excludes soft-deleted accounts.
 */
export async function getHouseAccounts(locationId: string, tx?: TxClient) {
  const client = getClient(tx)
  return client.houseAccount.findMany({
    where: { locationId, deletedAt: null },
    orderBy: { name: 'asc' },
  })
}

/**
 * Get active house accounts for a location.
 * Excludes soft-deleted and non-active accounts.
 */
export async function getActiveHouseAccounts(locationId: string, tx?: TxClient) {
  const client = getClient(tx)
  return client.houseAccount.findMany({
    where: { locationId, status: 'active', deletedAt: null },
    orderBy: { name: 'asc' },
  })
}

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Update a house account, enforcing locationId in the WHERE clause.
 *
 * Uses updateMany with composite where -- returns count, never throws on not-found.
 * This is safer than update() which only takes { id } in where and has no tenant guard.
 *
 * Throws if no matching house account was found (count === 0).
 */
export async function updateHouseAccount(
  id: string,
  locationId: string,
  data: Prisma.HouseAccountUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.houseAccount.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`HouseAccount ${id} not found for location ${locationId} -- update failed`)
  }
  return result
}

/**
 * Create a house account with locationId baked in.
 */
export async function createHouseAccount(
  locationId: string,
  data: Omit<Prisma.HouseAccountCreateInput, 'location'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.houseAccount.create({
    data: {
      ...data,
      location: { connect: { id: locationId } },
    },
  })
}
