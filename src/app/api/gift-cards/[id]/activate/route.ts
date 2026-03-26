/**
 * Gift Card Activation API
 *
 * POST /api/gift-cards/[id]/activate
 *
 * Activates an unactivated (pooled) gift card with a specified balance.
 * Sets initial/current balance, creates an 'activated' transaction,
 * and optionally sends email delivery.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { sendGiftCardEmail } from '@/lib/gift-card-email'
import { activateCardSchema } from '@/lib/domain/gift-cards/schemas'
import { activateGiftCard } from '@/lib/domain/gift-cards/activate-gift-card'

export const POST = withVenue(withAuth('CUSTOMERS_GIFT_CARDS', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id } = await ctx.params
    const locationId = ctx.auth.locationId
    const employeeId = ctx.auth.employeeId

    const body = await request.json()
    const parsed = activateCardSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { amount, recipientName, recipientEmail, recipientPhone, purchaserName, message } = parsed.data

    // Normalize email
    const normalizedEmail = recipientEmail?.toLowerCase().trim() || undefined

    // ── Verify card exists and belongs to this location ─────────────────
    const card = await db.giftCard.findUnique({
      where: { id },
      select: { id: true, status: true, locationId: true, cardNumber: true },
    })

    if (!card) {
      return NextResponse.json(
        { error: 'Gift card not found' },
        { status: 404 }
      )
    }

    if (card.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Gift card not found at this location' },
        { status: 404 }
      )
    }

    if (card.status !== 'unactivated') {
      return NextResponse.json(
        { error: `Card is already ${card.status}. Only unactivated cards can be activated.` },
        { status: 400 }
      )
    }

    // ── Activate inside transaction ─────────────────────────────────────
    const result = await db.$transaction(async (tx) => {
      return activateGiftCard(tx as any, id, amount, employeeId || 'system', {
        recipientName,
        recipientEmail: normalizedEmail,
        recipientPhone,
        purchaserName,
        message,
      })
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      )
    }

    const activatedCard = result.data as Record<string, unknown>

    // ── Fire-and-forget: Send email ─────────────────────────────────────
    if (normalizedEmail) {
      const location = await db.location.findUnique({
        where: { id: locationId },
        select: { name: true, address: true },
      })

      void sendGiftCardEmail({
        recipientEmail: normalizedEmail,
        recipientName: recipientName || undefined,
        cardCode: card.cardNumber,
        balance: amount,
        fromName: purchaserName || undefined,
        message: message || undefined,
        locationName: location?.name || 'Our Restaurant',
        locationAddress: location?.address || undefined,
      }).catch(err => console.error('[GiftCard] Email delivery failed:', err))
    }

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'gift-cards', action: 'updated', entityId: id })

    // Serialize Decimal fields for JSON response
    const responseCard = {
      ...activatedCard,
      initialBalance: Number(activatedCard.initialBalance),
      currentBalance: Number(activatedCard.currentBalance),
    }

    return NextResponse.json({ data: responseCard })
  } catch (error) {
    console.error('Failed to activate gift card:', error)
    return NextResponse.json(
      { error: 'Failed to activate gift card' },
      { status: 500 }
    )
  }
}))
