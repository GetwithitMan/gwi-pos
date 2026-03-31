import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitToLocation } from '@/lib/socket-server'
import { err, notFound, ok } from '@/lib/api-response'

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
      return err('Location ID required')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Verify customer exists
    const customer = await db.customer.findFirst({
      where: { id: customerId, locationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })

    if (!customer) {
      return notFound('Customer not found')
    }

    // Fetch saved cards — NEVER return tokens
    // No cardOnFile.enabled gate on GET — already-saved cards should always be listable
    // (memberships, house accounts, etc. need to read cards regardless of the tab-level setting)
    const cards = await db.$queryRaw<Array<{
      id: string
      last4: string
      cardBrand: string
      nickname: string | null
      isDefault: boolean
      expiryMonth: string | null
      expiryYear: string | null
      createdAt: Date
    }>>`
      SELECT id, last4, "cardBrand", nickname, "isDefault", "expiryMonth", "expiryYear", "createdAt"
       FROM "SavedCard"
       WHERE "customerId" = ${customerId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
       ORDER BY "isDefault" DESC, "createdAt" DESC`

    return ok({
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
      })
  } catch (error) {
    console.error('Failed to list saved cards:', error)
    return err('Failed to list saved cards', 500)
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
      return err('Location ID required')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)
    if (!token || !last4 || !cardBrand) {
      return err('Token, last4, and cardBrand are required')
    }
    if (!/^\d{4}$/.test(last4)) {
      return err('last4 must be exactly 4 digits')
    }

    // Verify customer exists
    const customer = await db.customer.findFirst({
      where: { id: customerId, locationId, deletedAt: null },
      select: { id: true },
    })

    if (!customer) {
      return notFound('Customer not found')
    }

    // Check settings
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)
    const cardSettings = settings.cardOnFile

    if (!cardSettings?.enabled) {
      return err('Card on file is not enabled')
    }

    if (!cardSettings.allowSaveCard) {
      return err('Saving cards is not currently allowed')
    }

    // Check max cards limit
    const existingCount = await db.$queryRaw<Array<{ count: string }>>`
      SELECT COUNT(*) as count FROM "SavedCard"
       WHERE "customerId" = ${customerId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL`
    const currentCount = Number(existingCount[0]?.count ?? 0)
    const maxCards = cardSettings.maxCardsPerCustomer ?? 5

    if (currentCount >= maxCards) {
      return err(`Maximum of ${maxCards} saved cards reached. Remove a card first.`)
    }

    // Check for duplicate (same last4 + brand already saved)
    const duplicate = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "SavedCard"
       WHERE "customerId" = ${customerId} AND "locationId" = ${locationId} AND last4 = ${last4}
         AND "cardBrand" = ${cardBrand} AND "deletedAt" IS NULL LIMIT 1`

    if (duplicate.length > 0) {
      return err('This card is already saved', 409)
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await db.$executeRaw`
        UPDATE "SavedCard" SET "isDefault" = false, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "customerId" = ${customerId} AND "locationId" = ${locationId} AND "isDefault" = true AND "deletedAt" IS NULL`
    }

    // Store the card — token is the Datacap tokenized value (already tokenized, not raw PAN)
    const cardId = `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const shouldBeDefault = isDefault || currentCount === 0 // First card is always default

    await db.$executeRaw`
      INSERT INTO "SavedCard" (id, "locationId", "customerId", token, last4, "cardBrand",
        "expiryMonth", "expiryYear", nickname, "isDefault", "consentMethod")
       VALUES (${cardId}, ${locationId}, ${customerId}, ${token}, ${last4}, ${cardBrand},
        ${expiryMonth || null}, ${expiryYear || null},
        ${nickname || null}, ${shouldBeDefault}, 'in_person')`

    void emitToLocation(locationId, 'customers:changed', { locationId }).catch(console.error)

    return ok({
        id: cardId,
        last4,
        cardBrand,
        nickname: nickname || null,
        isDefault: shouldBeDefault,
        savedAt: new Date(),
      })
  } catch (error) {
    console.error('Failed to save card:', error)
    return err('Failed to save card', 500)
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
      return err('Card ID required')
    }
    if (!locationId) {
      return err('Location ID required')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Verify the card belongs to this customer
    const card = await db.$queryRaw<Array<{ id: string; isDefault: boolean }>>`
      SELECT id, "isDefault" FROM "SavedCard"
       WHERE id = ${cardId} AND "customerId" = ${customerId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL LIMIT 1`

    if (!card.length) {
      return notFound('Card not found')
    }

    // Soft delete
    await db.$executeRaw`
      UPDATE "SavedCard" SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = ${cardId}`

    // If this was the default, promote the next card
    if (card[0].isDefault) {
      await db.$executeRaw`
        UPDATE "SavedCard" SET "isDefault" = true, "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = (
           SELECT id FROM "SavedCard"
           WHERE "customerId" = ${customerId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
           ORDER BY "createdAt" ASC LIMIT 1
         )`
    }

    void emitToLocation(locationId, 'customers:changed', { locationId }).catch(console.error)

    return ok({ success: true, cardId })
  } catch (error) {
    console.error('Failed to remove saved card:', error)
    return err('Failed to remove saved card', 500)
  }
})
