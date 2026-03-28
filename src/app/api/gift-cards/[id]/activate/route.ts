/**
 * Gift Card Activation API
 *
 * POST /api/gift-cards/[id]/activate
 *
 * Activates an unactivated (pooled) gift card with a specified balance.
 * Sets initial/current balance, creates an 'activated' transaction,
 * and optionally sends email delivery.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { sendGiftCardEmail } from '@/lib/gift-card-email'
import { activateCardSchema } from '@/lib/domain/gift-cards/schemas'
import { activateGiftCard } from '@/lib/domain/gift-cards/activate-gift-card'
import { dispatchGiftCardBalanceChanged } from '@/lib/socket-dispatch'
import { err, notFound, ok } from '@/lib/api-response'

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
      return err('Validation failed', 400, parsed.error.flatten().fieldErrors)
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
      return notFound('Gift card not found')
    }

    if (card.locationId !== locationId) {
      return notFound('Gift card not found at this location')
    }

    if (card.status !== 'unactivated') {
      return err(`Card is already ${card.status}. Only unactivated cards can be activated.`)
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
      return err(result.error)
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
    void dispatchGiftCardBalanceChanged(locationId, { giftCardId: id, newBalance: Number(activatedCard.currentBalance) })

    // Serialize Decimal fields for JSON response
    const responseCard = {
      ...activatedCard,
      initialBalance: Number(activatedCard.initialBalance),
      currentBalance: Number(activatedCard.currentBalance),
    }

    return ok(responseCard)
  } catch (error) {
    console.error('Failed to activate gift card:', error)
    return err('Failed to activate gift card', 500)
  }
}))
