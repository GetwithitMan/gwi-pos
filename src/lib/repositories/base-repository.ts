/**
 * Base Repository -- Tenant-Safe Data Access
 *
 * All tenant-scoped model access should go through repository methods.
 * Every method requires locationId as a parameter -- tenant isolation
 * is enforced by query shape, not interceptor injection.
 *
 * Prisma extensions in db-tenant-scope.ts remain as defense-in-depth.
 */

import { db } from '@/lib/db'
import type { PrismaClient } from '@/generated/prisma/client'

export type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/**
 * Get the DB client for repository operations.
 * Accepts an optional transaction client for operations within $transaction.
 */
export function getClient(tx?: TxClient): TxClient | typeof db {
  return tx ?? db
}
