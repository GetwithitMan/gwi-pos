/**
 * Allocate Pooled Gift Card
 *
 * Domain command that claims the next unactivated card from the pool
 * using FOR UPDATE SKIP LOCKED to avoid race conditions.
 *
 * Returns the card ID so the caller can then activate it.
 */

import { Prisma, type PrismaClient } from '@/generated/prisma/client'

interface AllocateResult {
  success: boolean
  cardId?: string
  error?: string
}

export async function allocatePooledGiftCard(
  tx: PrismaClient,
  locationId: string
): Promise<AllocateResult> {
  // Use raw SQL with FOR UPDATE SKIP LOCKED for atomic claim
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "GiftCard" WHERE "locationId" = ${locationId} AND status = 'unactivated' AND "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
  )

  if (!rows || rows.length === 0) {
    return {
      success: false,
      error: 'No card numbers available in the pool. Import more card numbers.',
    }
  }

  return { success: true, cardId: rows[0].id }
}
