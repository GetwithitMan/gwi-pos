import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { freezeGiftCard, unfreezeGiftCard } from '@/lib/domain/gift-cards/freeze-gift-card'
import { adjustGiftCardBalance } from '@/lib/domain/gift-cards/adjust-gift-card-balance'
import { freezeCardSchema, adjustBalanceSchema } from '@/lib/domain/gift-cards/schemas'
import { dispatchGiftCardBalanceChanged } from '@/lib/socket-dispatch'
import { err, notFound, ok } from '@/lib/api-response'

/** Serialize Decimal fields to numbers for JSON response */
function serializeCard(card: Record<string, unknown>) {
  return {
    ...card,
    initialBalance: Number(card.initialBalance),
    currentBalance: Number(card.currentBalance),
  }
}

// GET - Get gift card details (by ID or card number)
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    // Try to find by ID first, then by card number
    let giftCard = await db.giftCard.findUnique({
      where: { id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        }
      }
    })

    if (!giftCard) {
      // Try by card number
      giftCard = await db.giftCard.findUnique({
        where: { cardNumber: id.toUpperCase() },
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          }
        }
      })
    }

    if (!giftCard) {
      return notFound('Gift card not found')
    }

    // Verify location if provided
    if (locationId && giftCard.locationId !== locationId) {
      return notFound('Gift card not found at this location')
    }

    // Check if expired
    if (giftCard.expiresAt && new Date() > giftCard.expiresAt && giftCard.status === 'active') {
      await db.giftCard.update({
        where: { id: giftCard.id },
        data: { status: 'expired', lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' }
      })
      giftCard.status = 'expired'
    }

    return ok({
      ...giftCard,
      initialBalance: Number(giftCard.initialBalance),
      currentBalance: Number(giftCard.currentBalance),
      transactions: giftCard.transactions.map(t => ({
        ...t,
        amount: Number(t.amount),
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
      }))
    })
  } catch (error) {
    console.error('Failed to fetch gift card:', error)
    return err('Failed to fetch gift card', 500)
  }
})

// PUT - Update gift card (freeze/unfreeze, adjust, reload, redeem, refund)
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, amount, employeeId, orderId, notes, reason } = body

    // Handle different actions via domain commands
    switch (action) {
      // ─── Freeze ──────────────────────────────────────────────────────
      case 'freeze': {
        const parsed = freezeCardSchema.safeParse({ reason })
        if (!parsed.success) {
          return err(parsed.error.issues[0]?.message || 'Reason is required')
        }

        const result = await freezeGiftCard(db, id, parsed.data.reason, employeeId)
        if (!result.success) {
          return err(result.error)
        }

        void notifyDataChanged({ locationId: (result.data as Record<string, string>).locationId, domain: 'gift-cards', action: 'updated', entityId: id })
        void pushUpstream()
        return ok(serializeCard(result.data!))
      }

      // ─── Unfreeze ────────────────────────────────────────────────────
      case 'unfreeze': {
        const result = await unfreezeGiftCard(db, id, employeeId)
        if (!result.success) {
          return err(result.error)
        }

        void notifyDataChanged({ locationId: (result.data as Record<string, string>).locationId, domain: 'gift-cards', action: 'updated', entityId: id })
        return ok(serializeCard(result.data!))
      }

      // ─── Adjust (new explicit balance adjustment) ────────────────────
      case 'adjust': {
        const parsed = adjustBalanceSchema.safeParse({ amount, notes })
        if (!parsed.success) {
          return err(parsed.error.issues[0]?.message || 'Invalid adjustment input')
        }

        const result = await adjustGiftCardBalance(db, id, parsed.data.amount, parsed.data.notes, employeeId)
        if (!result.success) {
          return err(result.error)
        }

        void notifyDataChanged({ locationId: (result.data as Record<string, string>).locationId, domain: 'gift-cards', action: 'updated', entityId: id })
        void pushUpstream()
        void dispatchGiftCardBalanceChanged((result.data as Record<string, string>).locationId, { giftCardId: id, newBalance: Number((result.data as Record<string, unknown>).currentBalance) })
        return ok(serializeCard(result.data!))
      }

      // ─── Reload (positive balance add via Decimal math) ────────────
      case 'reload': {
        if (!amount || amount <= 0) {
          return err('Positive amount is required for reload')
        }

        // Verify card is active before reload
        const cardForReload = await db.giftCard.findUnique({ where: { id } })
        if (!cardForReload) {
          return notFound('Gift card not found')
        }
        if (cardForReload.status !== 'active') {
          return err('Can only reload active gift cards')
        }

        // Use Decimal math for reload
        const reloadBalanceBefore = cardForReload.currentBalance as Prisma.Decimal
        const reloadAmount = new Prisma.Decimal(amount)
        const reloadBalanceAfter = reloadBalanceBefore.add(reloadAmount)

        const reloaded = await db.giftCard.update({
          where: { id },
          data: {
            currentBalance: reloadBalanceAfter,
            lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
            transactions: {
              create: {
                locationId: cardForReload.locationId,
                type: 'reload',
                amount: reloadAmount,
                balanceBefore: reloadBalanceBefore,
                balanceAfter: reloadBalanceAfter,
                employeeId,
                orderId,
                notes: notes || 'Reload',
                performedByType: 'employee',
              }
            }
          },
          include: { transactions: { take: 1, orderBy: { createdAt: 'desc' } } }
        })

        void notifyDataChanged({ locationId: cardForReload.locationId, domain: 'gift-cards', action: 'updated', entityId: id })
        void pushUpstream()
        void dispatchGiftCardBalanceChanged(cardForReload.locationId, { giftCardId: id, newBalance: Number(reloadBalanceAfter) })
        return ok(serializeCard(reloaded as unknown as Record<string, unknown>))
      }

      // ─── Redeem (negative balance via Decimal math) ──────────────────
      case 'redeem': {
        if (!amount || amount <= 0) {
          return err('Positive amount is required for redemption')
        }

        const cardForRedeem = await db.giftCard.findUnique({ where: { id } })
        if (!cardForRedeem) {
          return notFound('Gift card not found')
        }
        if (cardForRedeem.status !== 'active') {
          return err('Gift card is not active')
        }

        const redeemBalanceBefore = cardForRedeem.currentBalance as Prisma.Decimal
        const redeemAmount = new Prisma.Decimal(amount)

        if (redeemAmount.greaterThan(redeemBalanceBefore)) {
          return NextResponse.json(
            { error: 'Insufficient balance', currentBalance: Number(redeemBalanceBefore) },
            { status: 400 }
          )
        }

        const redeemBalanceAfter = redeemBalanceBefore.sub(redeemAmount)
        const redeemStatus = redeemBalanceAfter.isZero() ? 'depleted' : 'active'

        const redeemed = await db.giftCard.update({
          where: { id },
          data: {
            currentBalance: redeemBalanceAfter,
            status: redeemStatus,
            lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
            transactions: {
              create: {
                locationId: cardForRedeem.locationId,
                type: 'redemption',
                amount: redeemAmount.negated(), // Negative for redemptions
                balanceBefore: redeemBalanceBefore,
                balanceAfter: redeemBalanceAfter,
                employeeId,
                orderId,
                notes: notes || 'Redemption',
                performedByType: 'employee',
              }
            }
          },
          include: { transactions: { take: 1, orderBy: { createdAt: 'desc' } } }
        })

        void notifyDataChanged({ locationId: cardForRedeem.locationId, domain: 'gift-cards', action: 'updated', entityId: id })
        void pushUpstream()
        void dispatchGiftCardBalanceChanged(cardForRedeem.locationId, { giftCardId: id, newBalance: Number(redeemBalanceAfter) })
        return ok({
          ...serializeCard(redeemed as unknown as Record<string, unknown>),
          amountRedeemed: amount,
        })
      }

      // ─── Refund (positive balance add via Decimal math) ──────────────
      case 'refund': {
        if (!amount || amount <= 0) {
          return err('Positive amount is required for refund')
        }

        const cardForRefund = await db.giftCard.findUnique({ where: { id } })
        if (!cardForRefund) {
          return notFound('Gift card not found')
        }

        const refundBalanceBefore = cardForRefund.currentBalance as Prisma.Decimal
        const refundAmount = new Prisma.Decimal(amount)
        const refundBalanceAfter = refundBalanceBefore.add(refundAmount)

        const refunded = await db.giftCard.update({
          where: { id },
          data: {
            currentBalance: refundBalanceAfter,
            status: 'active', // Reactivate if depleted
            lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
            transactions: {
              create: {
                locationId: cardForRefund.locationId,
                type: 'refund',
                amount: refundAmount,
                balanceBefore: refundBalanceBefore,
                balanceAfter: refundBalanceAfter,
                employeeId,
                orderId,
                notes: notes || 'Refund',
                performedByType: 'employee',
              }
            }
          },
          include: { transactions: { take: 1, orderBy: { createdAt: 'desc' } } }
        })

        void notifyDataChanged({ locationId: cardForRefund.locationId, domain: 'gift-cards', action: 'updated', entityId: id })
        void pushUpstream()
        void dispatchGiftCardBalanceChanged(cardForRefund.locationId, { giftCardId: id, newBalance: Number(refundBalanceAfter) })
        return ok(serializeCard(refunded as unknown as Record<string, unknown>))
      }

      default:
        return err('Invalid action. Use: freeze, unfreeze, adjust, reload, redeem, or refund')
    }
  } catch (error) {
    console.error('Failed to update gift card:', error)
    return err('Failed to update gift card', 500)
  }
}))
