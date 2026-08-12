/**
 * Order Number Allocator — Atomic, per-location, per-business-day.
 *
 * The allocator row is THE ONE serialized commit point per location/day.
 * SELECT FOR UPDATE on this row serializes concurrent check commits so
 * each receives a unique, monotonically increasing order number.
 *
 * New business days are seeded automatically via upsert — no cron needed.
 * The first commit of a new business day creates the allocator row with
 * nextNumber = 1, so order numbering resets daily.
 */

import { Prisma } from '@/generated/prisma/client'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('order-number-allocator')

type PrismaTransaction = Parameters<Parameters<typeof import('@/lib/db').db.$transaction>[0]>[0]

/**
 * Allocate the next order number for a location + business day.
 *
 * MUST be called inside a Prisma interactive transaction (`db.$transaction`).
 * The SELECT FOR UPDATE lock on the allocator row is the serialization point
 * that prevents concurrent commits from receiving the same number.
 *
 * @returns The allocated order number (starts at 1 for each new business day)
 */
export async function allocateOrderNumber(
  tx: PrismaTransaction,
  locationId: string,
  businessDate: string
): Promise<number> {
  // Step 1: Ensure allocator row exists for this business day (seed on first use).
  // ON CONFLICT DO NOTHING makes this safe for concurrent first-of-day commits.
  const id = crypto.randomUUID()
  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO "OrderNumberAllocator" ("id", "locationId", "businessDate", "nextNumber", "createdAt", "updatedAt")
      VALUES (${id}, ${locationId}, ${businessDate}, 1, NOW(), NOW())
      ON CONFLICT ("locationId", "businessDate") DO NOTHING
    `
  )

  // Step 2: Lock the row (SELECT FOR UPDATE) and read the current next number.
  // This is THE serialization point — concurrent commits block here until
  // the holder commits or rolls back.
  const rows = await tx.$queryRaw<{ nextNumber: number }[]>(
    Prisma.sql`
      SELECT "nextNumber"
      FROM "OrderNumberAllocator"
      WHERE "locationId" = ${locationId} AND "businessDate" = ${businessDate}
      FOR UPDATE
    `
  )

  if (!rows.length) {
    log.error({ locationId, businessDate }, 'allocator row missing after upsert')
    throw new Error('Order number allocator row missing')
  }

  const orderNumber = rows[0].nextNumber

  // Step 3: Increment for the next caller
  await tx.$executeRaw(
    Prisma.sql`
      UPDATE "OrderNumberAllocator"
      SET "nextNumber" = "nextNumber" + 1, "updatedAt" = NOW()
      WHERE "locationId" = ${locationId} AND "businessDate" = ${businessDate}
    `
  )

  log.info({ locationId, businessDate, orderNumber }, 'allocated order number')
  return orderNumber
}
