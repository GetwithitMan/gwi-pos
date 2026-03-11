import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, savedCardId } = body

    if (!locationId || !savedCardId) {
      return NextResponse.json({ error: 'locationId and savedCardId required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Fetch membership
    const mbrs: any[] = await db.$queryRawUnsafe(`
      SELECT "id", "customerId", "billingLockId", "savedCardId" AS "oldCardId"
      FROM "Membership"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId)
    if (mbrs.length === 0) return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    const mbr = mbrs[0]

    // Reject if billing lock active
    if (mbr.billingLockId) {
      return NextResponse.json({ error: 'Cannot replace card while billing is in progress' }, { status: 409 })
    }

    // Validate new card belongs to same customer
    const cards: any[] = await db.$queryRawUnsafe(`
      SELECT "id", "token", "last4", "cardBrand" FROM "SavedCard"
      WHERE "id" = $1 AND "locationId" = $2 AND "customerId" = $3 AND "deletedAt" IS NULL
      LIMIT 1
    `, savedCardId, locationId, mbr.customerId)
    if (cards.length === 0) {
      return NextResponse.json({ error: 'Card not found or does not belong to this customer' }, { status: 400 })
    }
    const card = cards[0]

    // Update membership — reset recurringData chain on card change
    await db.$executeRawUnsafe(`
      UPDATE "Membership"
      SET "savedCardId" = $2, "lastToken" = $3, "recurringData" = 'Recurring',
          "version" = "version" + 1, "updatedAt" = NOW()
      WHERE "id" = $1
    `, id, savedCardId, card.token)

    await db.$executeRawUnsafe(`
      INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
      VALUES ($1, $2, $3, $4, $5)
    `,
      locationId, id, MembershipEventType.CARD_UPDATED,
      JSON.stringify({ newCardLast4: card.last4, newCardBrand: card.cardBrand }),
      requestingEmployeeId || null
    )

    void dispatchMembershipUpdate(locationId, {
      action: 'card_updated', membershipId: id, customerId: mbr.customerId,
    }).catch(console.error)

    return NextResponse.json({ data: { success: true } })
  } catch (err) {
    console.error('[memberships/replace-card] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
