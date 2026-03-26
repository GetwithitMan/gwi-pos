/**
 * Adjust Gift Card Balance
 *
 * Domain command for crediting or debiting a gift card balance.
 * ALL arithmetic uses Prisma Decimal — never Number(balance) + amount.
 *
 * - Positive amount: adjustment_credit (reactivates depleted cards)
 * - Negative amount: adjustment_debit (cannot go below 0)
 * - Zero balance after debit: sets status to 'depleted'
 * - Reason is REQUIRED — caller must validate before calling
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { Prisma } from '@/generated/prisma/client'

interface AdjustResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

export async function adjustGiftCardBalance(
  tx: PrismaClient,
  cardId: string,
  amount: number,
  reason: string,
  employeeId: string
): Promise<AdjustResult> {
  // Reason is required
  if (!reason || reason.trim().length === 0) {
    return { success: false, error: 'Reason is required for balance adjustments' }
  }

  const card = await tx.giftCard.findUnique({ where: { id: cardId } })
  if (!card) {
    return { success: false, error: 'Gift card not found' }
  }

  const decimalAmount = new Prisma.Decimal(amount)
  const balanceBefore = card.currentBalance as Prisma.Decimal

  // Negative adjustment: balance cannot go below 0
  if (decimalAmount.isNegative()) {
    const wouldBe = balanceBefore.add(decimalAmount)
    if (wouldBe.isNegative()) {
      return {
        success: false,
        error: `Insufficient balance. Current: $${balanceBefore.toFixed(2)}, adjustment: $${decimalAmount.toFixed(2)}`,
      }
    }
  }

  const balanceAfter = balanceBefore.add(decimalAmount)
  const transactionType = decimalAmount.isNegative() ? 'adjustment_debit' : 'adjustment_credit'

  // Determine new status
  let newStatus = card.status
  if (balanceAfter.isZero()) {
    newStatus = 'depleted'
  } else if (decimalAmount.greaterThan(new Prisma.Decimal(0)) && card.status === 'depleted') {
    // Positive adjustment on depleted card: reactivate
    newStatus = 'active'
  }

  const updatedCard = await tx.giftCard.update({
    where: { id: cardId },
    data: {
      currentBalance: balanceAfter,
      status: newStatus,
      transactions: {
        create: {
          locationId: card.locationId,
          type: transactionType,
          amount: decimalAmount,
          balanceBefore,
          balanceAfter,
          employeeId,
          notes: reason,
          performedByType: 'employee',
        },
      },
    },
    include: {
      transactions: {
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  console.log(
    `[AUDIT] GIFT_CARD_ADJUSTMENT: card=${card.cardNumber}, type=${transactionType}, amount=$${decimalAmount.toFixed(2)}, before=$${balanceBefore.toFixed(2)}, after=$${balanceAfter.toFixed(2)}, status=${newStatus}, by employee ${employeeId}, reason="${reason}"`
  )

  return { success: true, data: updatedCard as unknown as Record<string, unknown> }
}
