/**
 * Gift Card Generate Range API
 *
 * POST /api/gift-cards/generate-range
 *
 * Generates a sequential range of card numbers with a given prefix.
 * Format: {PREFIX}-{NNNN}-0000-0000
 *
 * Supports dry-run mode to preview generated numbers without creating them.
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { generateRangeSchema } from '@/lib/domain/gift-cards/schemas'

function generateCardNumbers(prefix: string, start: number, end: number, zeroPad: number): string[] {
  const numbers: string[] = []
  const upperPrefix = prefix.toUpperCase()

  for (let i = start; i <= end; i++) {
    const padded = String(i).padStart(zeroPad, '0')
    numbers.push(`${upperPrefix}-${padded}-0000-0000`)
  }

  return numbers
}

export const POST = withVenue(withAuth('CUSTOMERS_GIFT_CARDS', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const locationId = ctx.auth.locationId
    const body = await request.json()

    const parsed = generateRangeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { prefix, start, end, zeroPad, dryRun } = parsed.data
    const count = end - start + 1

    if (count > 5000) {
      return NextResponse.json(
        { error: 'Maximum 5000 cards per batch. Reduce the range.' },
        { status: 400 }
      )
    }

    const cardNumbers = generateCardNumbers(prefix, start, end, zeroPad)

    // ── Dry run: preview only ─────────────────────────────────────────────
    if (dryRun) {
      return NextResponse.json({
        preview: cardNumbers,
        count: cardNumbers.length,
      })
    }

    // ── Check for collisions with existing DB cards ───────────────────────
    const existingCards = await db.giftCard.findMany({
      where: { cardNumber: { in: cardNumbers } },
      select: { cardNumber: true },
    })
    const existingSet = new Set(existingCards.map(c => c.cardNumber))

    const toCreate = cardNumbers.filter(cn => !existingSet.has(cn))
    const skipped = cardNumbers.length - toCreate.length

    if (toCreate.length === 0) {
      return NextResponse.json({
        generated: 0,
        skipped,
        batchId: null,
        error: 'All generated card numbers already exist in the database',
      })
    }

    // ── Bulk create ───────────────────────────────────────────────────────
    const batchId = randomUUID()

    await db.giftCard.createMany({
      data: toCreate.map(cardNumber => ({
        locationId,
        cardNumber,
        initialBalance: 0,
        currentBalance: 0,
        status: 'unactivated' as const,
        source: 'range',
        batchId,
      })),
    })

    console.log(
      `[AUDIT] GIFT_CARDS_GENERATED: batch=${batchId}, prefix=${prefix}, range=${start}-${end}, count=${toCreate.length}, skipped=${skipped}, by employee ${ctx.auth.employeeId}`
    )

    void notifyDataChanged({ locationId, domain: 'gift-cards', action: 'created' })

    return NextResponse.json({
      generated: toCreate.length,
      skipped,
      batchId,
    })
  } catch (error) {
    console.error('Failed to generate gift card range:', error)
    return NextResponse.json(
      { error: 'Failed to generate gift card range' },
      { status: 500 }
    )
  }
}))
