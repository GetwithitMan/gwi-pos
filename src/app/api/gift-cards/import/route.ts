/**
 * Gift Card Import API
 *
 * POST /api/gift-cards/import
 *
 * Bulk-imports card numbers into the pool as 'unactivated' cards.
 * Accepts both CSV (text/csv) and JSON (application/json) payloads.
 *
 * CSV format: one card number per line, optional PIN in second column (comma or tab separated)
 * JSON format: { cardNumbers: string[], pins?: string[] }
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { importCardsSchema } from '@/lib/domain/gift-cards/schemas'

// Card number validation: uppercase alphanumeric with dashes, 4-30 chars
const CARD_NUMBER_REGEX = /^[A-Z0-9-]+$/
const MIN_LENGTH = 4
const MAX_LENGTH = 30

interface ImportError {
  row: number
  cardNumber: string
  error: string
}

function validateCardNumber(raw: string, row: number): { valid: true; cardNumber: string } | { valid: false; error: ImportError } {
  const cardNumber = raw.trim().toUpperCase()

  if (cardNumber.length < MIN_LENGTH) {
    return { valid: false, error: { row, cardNumber, error: `Too short (min ${MIN_LENGTH} characters)` } }
  }
  if (cardNumber.length > MAX_LENGTH) {
    return { valid: false, error: { row, cardNumber, error: `Too long (max ${MAX_LENGTH} characters)` } }
  }
  if (!CARD_NUMBER_REGEX.test(cardNumber)) {
    return { valid: false, error: { row, cardNumber, error: 'Invalid characters. Only A-Z, 0-9, and dashes allowed.' } }
  }

  return { valid: true, cardNumber }
}

function parseCSV(text: string): { cardNumbers: string[]; pins: (string | undefined)[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  const cardNumbers: string[] = []
  const pins: (string | undefined)[] = []

  for (const line of lines) {
    // Support both comma and tab separators
    const parts = line.includes('\t') ? line.split('\t') : line.split(',')
    cardNumbers.push(parts[0].trim())
    pins.push(parts[1]?.trim() || undefined)
  }

  return { cardNumbers, pins }
}

export const POST = withVenue(withAuth('CUSTOMERS_GIFT_CARDS', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const locationId = ctx.auth.locationId
    const contentType = request.headers.get('content-type') || ''

    let rawCardNumbers: string[]
    let rawPins: (string | undefined)[] = []

    // ── Parse input based on content type ─────────────────────────────────
    if (contentType.includes('text/csv')) {
      const text = await request.text()
      const parsed = parseCSV(text)
      rawCardNumbers = parsed.cardNumbers
      rawPins = parsed.pins
    } else {
      const body = await request.json()
      const parsed = importCardsSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        )
      }
      rawCardNumbers = parsed.data.cardNumbers
      rawPins = parsed.data.pins || []
    }

    if (rawCardNumbers.length === 0) {
      return NextResponse.json(
        { error: 'No card numbers provided' },
        { status: 400 }
      )
    }

    if (rawCardNumbers.length > 5000) {
      return NextResponse.json(
        { error: 'Maximum 5000 cards per import batch' },
        { status: 400 }
      )
    }

    // ── Validate each card number ─────────────────────────────────────────
    const errors: ImportError[] = []
    const validCards: { cardNumber: string; pin?: string }[] = []
    const seenInBatch = new Set<string>()

    for (let i = 0; i < rawCardNumbers.length; i++) {
      const result = validateCardNumber(rawCardNumbers[i], i + 1)
      if (!result.valid) {
        errors.push(result.error)
        continue
      }

      // Check for duplicates within the batch
      if (seenInBatch.has(result.cardNumber)) {
        errors.push({ row: i + 1, cardNumber: result.cardNumber, error: 'Duplicate within batch' })
        continue
      }

      seenInBatch.add(result.cardNumber)
      validCards.push({ cardNumber: result.cardNumber, pin: rawPins[i] })
    }

    if (validCards.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: errors.length,
        errors,
        batchId: null,
      })
    }

    // ── Check for collisions with existing DB cards ───────────────────────
    const cardNumbersToCheck = validCards.map(c => c.cardNumber)
    const existingCards = await db.giftCard.findMany({
      where: { cardNumber: { in: cardNumbersToCheck } },
      select: { cardNumber: true },
    })
    const existingSet = new Set(existingCards.map(c => c.cardNumber))

    const toImport: { cardNumber: string; pin?: string }[] = []
    for (const card of validCards) {
      if (existingSet.has(card.cardNumber)) {
        errors.push({ row: 0, cardNumber: card.cardNumber, error: 'Card number already exists in database' })
      } else {
        toImport.push(card)
      }
    }

    if (toImport.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: errors.length,
        errors,
        batchId: null,
      })
    }

    // ── Bulk create ───────────────────────────────────────────────────────
    const batchId = randomUUID()

    await db.giftCard.createMany({
      data: toImport.map(card => ({
        locationId,
        cardNumber: card.cardNumber,
        pin: card.pin || null,
        initialBalance: 0,
        currentBalance: 0,
        status: 'unactivated' as const,
        source: 'import',
        batchId,
        lastMutatedBy: 'cloud',
      })),
    })

    console.log(
      `[AUDIT] GIFT_CARDS_IMPORTED: batch=${batchId}, count=${toImport.length}, skipped=${errors.length}, by employee ${ctx.auth.employeeId}`
    )

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'gift-cards', action: 'created' })

    return NextResponse.json({
      imported: toImport.length,
      skipped: errors.length,
      errors,
      batchId,
    })
  } catch (error) {
    console.error('Failed to import gift cards:', error)
    return NextResponse.json(
      { error: 'Failed to import gift cards' },
      { status: 500 }
    )
  }
}))
