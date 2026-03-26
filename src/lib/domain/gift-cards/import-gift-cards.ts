/**
 * Import Gift Cards
 *
 * Domain command for bulk-importing card numbers into the pool.
 * Cards are created with status 'unactivated' and zero balance.
 *
 * - Normalizes card numbers: trim + uppercase
 * - Checks for duplicates within the batch
 * - Checks for collisions with existing DB cards (bulk SELECT)
 * - Bulk createMany for valid entries
 */

import type { PrismaClient } from '@/generated/prisma/client'

interface ImportEntry {
  cardNumber: string
  pin?: string
}

interface ImportError {
  row: number
  cardNumber: string
  error: string
}

interface ImportResult {
  imported: number
  skipped: number
  errors: ImportError[]
  batchId: string
}

export async function importGiftCards(
  tx: PrismaClient,
  locationId: string,
  entries: ImportEntry[],
  source: 'import' | 'range',
  batchId: string
): Promise<ImportResult> {
  const errors: ImportError[] = []
  const seen = new Set<string>()
  const validEntries: { cardNumber: string; pin?: string; row: number }[] = []

  // Phase 1: Normalize and check for within-batch duplicates
  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i]
    const cardNumber = raw.cardNumber.trim().toUpperCase()

    if (seen.has(cardNumber)) {
      errors.push({ row: i + 1, cardNumber, error: 'Duplicate within batch' })
      continue
    }

    seen.add(cardNumber)
    validEntries.push({ cardNumber, pin: raw.pin, row: i + 1 })
  }

  if (validEntries.length === 0) {
    return { imported: 0, skipped: errors.length, errors, batchId }
  }

  // Phase 2: Check for collisions with existing DB cards (bulk SELECT)
  const cardNumbers = validEntries.map(e => e.cardNumber)
  const existing = await tx.giftCard.findMany({
    where: { cardNumber: { in: cardNumbers } },
    select: { cardNumber: true },
  })

  const existingSet = new Set(existing.map(e => e.cardNumber))
  const toCreate: { cardNumber: string; pin?: string }[] = []

  for (const entry of validEntries) {
    if (existingSet.has(entry.cardNumber)) {
      errors.push({ row: entry.row, cardNumber: entry.cardNumber, error: 'Card number already exists' })
    } else {
      toCreate.push({ cardNumber: entry.cardNumber, pin: entry.pin })
    }
  }

  if (toCreate.length === 0) {
    return { imported: 0, skipped: entries.length - toCreate.length, errors, batchId }
  }

  // Phase 3: Bulk create
  await tx.giftCard.createMany({
    data: toCreate.map(entry => ({
      locationId,
      cardNumber: entry.cardNumber,
      pin: entry.pin || null,
      initialBalance: 0,
      currentBalance: 0,
      status: 'unactivated' as const,
      source,
      batchId,
    })),
  })

  const imported = toCreate.length
  const skipped = entries.length - imported

  console.log(
    `[AUDIT] GIFT_CARDS_IMPORTED: batch=${batchId}, source=${source}, imported=${imported}, skipped=${skipped}, location=${locationId}`
  )

  return { imported, skipped, errors, batchId }
}
