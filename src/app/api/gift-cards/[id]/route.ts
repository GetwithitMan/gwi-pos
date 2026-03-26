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
      return NextResponse.json(
        { error: 'Gift card not found' },
        { status: 404 }
      )
    }

    // Verify location if provided
    if (locationId && giftCard.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Gift card not found at this location' },
        { status: 404 }
      )
    }

    // Check if expired
    if (giftCard.expiresAt && new Date() > giftCard.expiresAt && giftCard.status === 'active') {
      await db.giftCard.update({
        where: { id: giftCard.id },
        data: { status: 'expired', lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' }
      })
      giftCard.status = 'expired'
    }

    return NextResponse.json({ data: {
      ...giftCard,
      initialBalance: Number(giftCard.initialBalance),
      currentBalance: Number(giftCard.currentBalance),
      transactions: giftCard.transactions.map(t => ({
        ...t,
        amount: Number(t.amount),
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
      }))
    } })
  } catch (error) {
    console.error('Failed to fetch gift card:', error)
    return NextResponse.json(
      { error: 'Failed to fetch gift card' },
      { status: 500 }
    )
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
          return NextResponse.json(
            { error: parsed.error.issues[0]?.message || 'Reason is required' },
            { status: 400 }
          )
        }

        const result = await freezeGiftCard(db, id, parsed.data.reason, employeeId)
        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }

        void notifyDataChanged({ locationId: (result.data as Record<string, string>).locationId, domain: 'gift-cards', action: 'updated', entityId: id })
        void pushUpstream()
        return NextResponse.json({ data: serializeCard(result.data!) })
      }

      // ─── Unfreeze ────────────────────────────────────────────────────
      case 'unfreeze': {
        const result = await unfreezeGiftCard(db, id, employeeId)
        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }

        void notifyDataChanged({ locationId: (result.data as Record<string, string>).locationId, domain: 'gift-cards', action: 'updated', entityId: id })
        return NextResponse.json({ data: serializeCard(result.data!) })
      }

      // ─── Adjust (new explicit balance adjustment) ────────────────────
      case 'adjust': {
        const parsed = adjustBalanceSchema.safeParse({ amount, notes })
        if (!parsed.success) {
          return NextResponse.json(
            { error: parsed.error.issues[0]?.message || 'Invalid adjustment input' },
            { status: 400 }
          )
        }

        const result = await adjustGiftCardBalance(db, id, parsed.data.amount, parsed.data.notes, employeeId)
        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }

        void notifyDataChanged({ locationId: (result.data as Record<string, string>).locationId, domain: 'gift-cards', action: 'updated', entityId: id })
        void pushUpstream()
        return NextResponse.json({ data: serializeCard(result.data!) })
      }

      // ─── Reload (positive balance add via Decimal math) ────────────
      case 'reload': {
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { error: 'Positive amount is required for reload' },
            { status: 400 }
          )
        }

        // Verify card is active before reload
        const cardForReload = await db.giftCard.findUnique({ where: { id } })
        if (!cardForReload) {
          return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
        }
        if (cardForReload.status !== 'active') {
          return NextResponse.json({ error: 'Can only reload active gift cards' }, { status: 400 })
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
        return NextResponse.json({ data: serializeCard(reloaded as unknown as Record<string, unknown>) })
      }

      // ─── Redeem (negative balance via Decimal math) ──────────────────
      case 'redeem': {
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { error: 'Positive amount is required for redemption' },
            { status: 400 }
          )
        }

        const cardForRedeem = await db.giftCard.findUnique({ where: { id } })
        if (!cardForRedeem) {
          return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
        }
        if (cardForRedeem.status !== 'active') {
          return NextResponse.json({ error: 'Gift card is not active' }, { status: 400 })
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
        return NextResponse.json({ data: {
          ...serializeCard(redeemed as unknown as Record<string, unknown>),
          amountRedeemed: amount,
        } })
      }

      // ─── Refund (positive balance add via Decimal math) ──────────────
      case 'refund': {
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { error: 'Positive amount is required for refund' },
            { status: 400 }
          )
        }

        const cardForRefund = await db.giftCard.findUnique({ where: { id } })
        if (!cardForRefund) {
          return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
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
        return NextResponse.json({ data: serializeCard(refunded as unknown as Record<string, unknown>) })
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: freeze, unfreeze, adjust, reload, redeem, or refund' },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Failed to update gift card:', error)
    return NextResponse.json(
      { error: 'Failed to update gift card' },
      { status: 500 }
    )
  }
}))
