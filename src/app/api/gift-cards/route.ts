import { randomInt } from 'crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { sendGiftCardEmail } from '@/lib/gift-card-email'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { parseSettings } from '@/lib/settings'
import { allocatePooledGiftCard } from '@/lib/domain/gift-cards/allocate-pooled-gift-card'
import { activateGiftCard } from '@/lib/domain/gift-cards/activate-gift-card'
import { dispatchGiftCardBalanceChanged } from '@/lib/socket-dispatch'
import { created, err, ok } from '@/lib/api-response'

// Generate a unique gift card number
function generateCardNumber(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = 'GC-'
  for (let i = 0; i < 4; i++) {
    if (i > 0) result += '-'
    for (let j = 0; j < 4; j++) {
      result += chars.charAt(randomInt(chars.length))
    }
  }
  return result
}

// GET - List gift cards
// No auth required — POS terminals need gift card lookup for checkout
export const GET = withVenue(async function GET(
  request: NextRequest,
) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return err('locationId is required')
    }

    const where: Record<string, unknown> = { locationId }

    if (status) {
      where.status = status
    }

    if (search) {
      where.OR = [
        { cardNumber: { contains: search } },
        { recipientName: { contains: search } },
        { recipientEmail: { contains: search } },
        { purchaserName: { contains: search } },
      ]
    }

    const giftCards = await db.giftCard.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { transactions: true }
        }
      }
    })

    return ok(giftCards.map(card => ({
      ...card,
      initialBalance: Number(card.initialBalance),
      currentBalance: Number(card.currentBalance),
    })))
  } catch (error) {
    console.error('Failed to fetch gift cards:', error)
    return err('Failed to fetch gift cards', 500)
  }
})

// POST - Create/purchase a new gift card
// Auth: session-verified employee with CUSTOMERS_GIFT_CARDS permission
export const POST = withVenue(withAuth('CUSTOMERS_GIFT_CARDS', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const body = await request.json()
    const {
      amount,
      recipientName,
      recipientEmail,
      recipientPhone,
      purchaserName,
      message,
      orderId,
      expiresAt,
    } = body

    // Use verified locationId and employeeId from session
    const locationId = ctx.auth.locationId
    const purchasedById = ctx.auth.employeeId

    if (!amount || amount <= 0) {
      return err('A positive amount is required')
    }

    // Gift card creation must be tied to a payment (anti-fraud guard)
    const skipPaymentCheck = body.skipPaymentCheck === true
    if (!orderId && !skipPaymentCheck) {
      return err('Gift card creation requires an associated order. Use the POS payment flow to create gift cards.')
    }

    // ── Check pool mode from location settings ──────────────────────────
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { name: true, address: true, settings: true },
    })
    const settings = parseSettings(location?.settings)
    const isPoolMode = settings.payments?.giftCardPoolMode === 'pool'

    let giftCard: Record<string, unknown>

    if (isPoolMode) {
      // ── Pool mode: allocate from pool and activate ──────────────────
      const result = await db.$transaction(async (tx) => {
        const allocation = await allocatePooledGiftCard(tx as any, locationId)
        if (!allocation.success) {
          return { success: false as const, error: allocation.error }
        }

        const activation = await activateGiftCard(tx as any, allocation.cardId as string, amount, ctx.auth.employeeId ?? 'system', {
          recipientName,
          recipientEmail,
          recipientPhone,
          purchaserName,
          message,
        })

        if (!activation.success) {
          return { success: false as const, error: activation.error }
        }

        // Also link the order if provided
        if (orderId) {
          await (tx as any).giftCard.update({
            where: { id: allocation.cardId },
            data: { orderId },
          })
        }

        return { success: true as const, data: activation.data }
      })

      if (!result.success) {
        return err(result.error!)
      }

      giftCard = result.data as Record<string, unknown>
    } else {
      // ── Open mode: generate random card number (existing behavior) ──
      let cardNumber = generateCardNumber()
      let attempts = 0
      while (attempts < 10) {
        const existing = await db.giftCard.findUnique({
          where: { cardNumber }
        })
        if (!existing) break
        cardNumber = generateCardNumber()
        attempts++
      }

      const created = await db.giftCard.create({
        data: {
          locationId,
          cardNumber,
          initialBalance: amount,
          currentBalance: amount,
          status: 'active',
          source: 'manual',
          recipientName,
          recipientEmail,
          recipientPhone,
          purchaserName,
          message,
          purchasedById,
          orderId,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          lastMutatedBy: 'cloud',
          transactions: {
            create: {
              locationId,
              type: 'purchase',
              amount,
              balanceBefore: 0,
              balanceAfter: amount,
              orderId,
              employeeId: purchasedById,
              notes: 'Initial purchase',
            }
          }
        },
        include: {
          transactions: true,
        }
      })

      giftCard = created as unknown as Record<string, unknown>
    }

    // Audit trail for gift card creation
    console.log(`[AUDIT] GIFT_CARD_CREATED: card=${giftCard.cardNumber}, balance=$${Number(giftCard.initialBalance)}, mode=${isPoolMode ? 'pool' : 'open'}, by employee ${purchasedById}, orderId=${orderId || 'NONE'}`)

    void notifyDataChanged({ locationId, domain: 'gift-cards', action: 'created', entityId: giftCard.id as string })
    void pushUpstream()
    void dispatchGiftCardBalanceChanged(locationId, { giftCardId: giftCard.id as string, newBalance: Number(giftCard.currentBalance) })

    // Fire-and-forget: Send gift card email to recipient if email provided
    if (recipientEmail) {
      void sendGiftCardEmail({
        recipientEmail,
        recipientName: recipientName || undefined,
        cardCode: giftCard.cardNumber as string,
        balance: Number(giftCard.initialBalance),
        fromName: purchaserName || undefined,
        message: message || undefined,
        locationName: location?.name || 'Our Restaurant',
        locationAddress: location?.address || undefined,
      }).catch(err => console.error('[GiftCard] Email delivery failed:', err))
    }

    return created({
      ...giftCard,
      initialBalance: Number(giftCard.initialBalance),
      currentBalance: Number(giftCard.currentBalance),
    })
  } catch (error) {
    console.error('Failed to create gift card:', error)
    return err('Failed to create gift card', 500)
  }
}))
