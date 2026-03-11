import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'

// GET - List saved cards for a customer
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    // Verify customer exists
    const customer = await db.customer.findFirst({
      where: { id: customerId, locationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // Fetch saved cards — NEVER return tokens
    // No cardOnFile.enabled gate on GET — already-saved cards should always be listable
    // (memberships, house accounts, etc. need to read cards regardless of the tab-level setting)
    const cards = await db.$queryRawUnsafe<Array<{
      id: string
      last4: string
      cardBrand: string
      nickname: string | null
      isDefault: boolean
      expiryMonth: string | null
      expiryYear: string | null
      createdAt: Date
    }>>(
      `SELECT id, last4, "cardBrand", nickname, "isDefault", "expiryMonth", "expiryYear", "createdAt"
       FROM "SavedCard"
       WHERE "customerId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
       ORDER BY "isDefault" DESC, "createdAt" DESC`,
      customerId, locationId
    )

    return NextResponse.json({
      data: {
        customerId,
        cards: cards.map(c => ({
          id: c.id,
          last4: c.last4,
          cardBrand: c.cardBrand,
          nickname: c.nickname,
          isDefault: c.isDefault,
          expiryMonth: c.expiryMonth,
          expiryYear: c.expiryYear,
          savedAt: c.createdAt,
        })),
      },
    })
  } catch (error) {
    console.error('Failed to list saved cards:', error)
    return NextResponse.json({ error: 'Failed to list saved cards' }, { status: 500 })
  }
})

// POST - Save a card for a customer
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
    const body = await request.json()
    const { locationId, token, last4, cardBrand, expiryMonth, expiryYear, nickname, isDefault } = body

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }
    if (!token || !last4 || !cardBrand) {
      return NextResponse.json({ error: 'Token, last4, and cardBrand are required' }, { status: 400 })
    }
    if (!/^\d{4}$/.test(last4)) {
      return NextResponse.json({ error: 'last4 must be exactly 4 digits' }, { status: 400 })
    }

    // Verify customer exists
    const customer = await db.customer.findFirst({
      where: { id: customerId, locationId, deletedAt: null },
      select: { id: true },
    })

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // Check settings
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)
    const cardSettings = settings.cardOnFile

    if (!cardSettings?.enabled) {
      return NextResponse.json({ error: 'Card on file is not enabled' }, { status: 400 })
    }

    if (!cardSettings.allowSaveCard) {
      return NextResponse.json({ error: 'Saving cards is not currently allowed' }, { status: 400 })
    }

    // Check max cards limit
    const existingCount = await db.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT COUNT(*) as count FROM "SavedCard"
       WHERE "customerId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      customerId, locationId
    )
    const currentCount = Number(existingCount[0]?.count ?? 0)
    const maxCards = cardSettings.maxCardsPerCustomer ?? 5

    if (currentCount >= maxCards) {
      return NextResponse.json({
        error: `Maximum of ${maxCards} saved cards reached. Remove a card first.`,
      }, { status: 400 })
    }

    // Check for duplicate (same last4 + brand already saved)
    const duplicate = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "SavedCard"
       WHERE "customerId" = $1 AND "locationId" = $2 AND last4 = $3
         AND "cardBrand" = $4 AND "deletedAt" IS NULL LIMIT 1`,
      customerId, locationId, last4, cardBrand
    )

    if (duplicate.length > 0) {
      return NextResponse.json({ error: 'This card is already saved' }, { status: 409 })
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await db.$executeRawUnsafe(
        `UPDATE "SavedCard" SET "isDefault" = false, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "customerId" = $1 AND "locationId" = $2 AND "isDefault" = true AND "deletedAt" IS NULL`,
        customerId, locationId
      )
    }

    // Store the card — token is the Datacap tokenized value (already tokenized, not raw PAN)
    const cardId = `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const shouldBeDefault = isDefault || currentCount === 0 // First card is always default

    await db.$executeRawUnsafe(
      `INSERT INTO "SavedCard" (id, "locationId", "customerId", token, last4, "cardBrand",
        "expiryMonth", "expiryYear", nickname, "isDefault", "consentMethod")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'in_person')`,
      cardId, locationId, customerId, token, last4, cardBrand,
      expiryMonth || null, expiryYear || null,
      nickname || null, shouldBeDefault
    )

    return NextResponse.json({
      data: {
        id: cardId,
        last4,
        cardBrand,
        nickname: nickname || null,
        isDefault: shouldBeDefault,
        savedAt: new Date(),
      },
    })
  } catch (error) {
    console.error('Failed to save card:', error)
    return NextResponse.json({ error: 'Failed to save card' }, { status: 500 })
  }
})

// DELETE - Remove a saved card (soft delete)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
    const { searchParams } = new URL(request.url)
    const cardId = searchParams.get('cardId')
    const locationId = searchParams.get('locationId')

    if (!cardId) {
      return NextResponse.json({ error: 'Card ID required' }, { status: 400 })
    }
    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    // Verify the card belongs to this customer
    const card = await db.$queryRawUnsafe<Array<{ id: string; isDefault: boolean }>>(
      `SELECT id, "isDefault" FROM "SavedCard"
       WHERE id = $1 AND "customerId" = $2 AND "locationId" = $3 AND "deletedAt" IS NULL LIMIT 1`,
      cardId, customerId, locationId
    )

    if (!card.length) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }

    // Soft delete
    await db.$executeRawUnsafe(
      `UPDATE "SavedCard" SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1`,
      cardId
    )

    // If this was the default, promote the next card
    if (card[0].isDefault) {
      await db.$executeRawUnsafe(
        `UPDATE "SavedCard" SET "isDefault" = true, "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = (
           SELECT id FROM "SavedCard"
           WHERE "customerId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
           ORDER BY "createdAt" ASC LIMIT 1
         )`,
        customerId, locationId
      )
    }

    return NextResponse.json({ data: { success: true, cardId } })
  } catch (error) {
    console.error('Failed to remove saved card:', error)
    return NextResponse.json({ error: 'Failed to remove saved card' }, { status: 500 })
  }
})
