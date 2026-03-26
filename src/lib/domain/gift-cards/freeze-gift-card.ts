/**
 * Freeze / Unfreeze Gift Card
 *
 * Domain commands for freezing (suspending) and unfreezing a gift card.
 *
 * freeze: active -> frozen (reason required)
 * unfreeze: frozen -> active (clears frozenAt/frozenReason)
 *
 * Both create a GiftCardTransaction for the audit trail.
 */

import type { PrismaClient } from '@/generated/prisma/client'

interface FreezeResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

export async function freezeGiftCard(
  tx: PrismaClient,
  cardId: string,
  reason: string,
  employeeId: string
): Promise<FreezeResult> {
  const card = await tx.giftCard.findUnique({ where: { id: cardId } })
  if (!card) {
    return { success: false, error: 'Gift card not found' }
  }

  if (card.status !== 'active') {
    return { success: false, error: 'Can only freeze active gift cards' }
  }

  const updatedCard = await tx.giftCard.update({
    where: { id: cardId },
    data: {
      status: 'frozen',
      frozenAt: new Date(),
      frozenReason: reason,
      transactions: {
        create: {
          locationId: card.locationId,
          type: 'frozen',
          amount: 0,
          balanceBefore: card.currentBalance,
          balanceAfter: card.currentBalance,
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
    `[AUDIT] GIFT_CARD_FROZEN: card=${card.cardNumber}, reason="${reason}", by employee ${employeeId}`
  )

  return { success: true, data: updatedCard as unknown as Record<string, unknown> }
}

export async function unfreezeGiftCard(
  tx: PrismaClient,
  cardId: string,
  employeeId: string
): Promise<FreezeResult> {
  const card = await tx.giftCard.findUnique({ where: { id: cardId } })
  if (!card) {
    return { success: false, error: 'Gift card not found' }
  }

  if (card.status !== 'frozen') {
    return { success: false, error: 'Can only unfreeze frozen gift cards' }
  }

  const updatedCard = await tx.giftCard.update({
    where: { id: cardId },
    data: {
      status: 'active',
      frozenAt: null,
      frozenReason: null,
      transactions: {
        create: {
          locationId: card.locationId,
          type: 'unfrozen',
          amount: 0,
          balanceBefore: card.currentBalance,
          balanceAfter: card.currentBalance,
          employeeId,
          notes: 'Card unfrozen',
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
    `[AUDIT] GIFT_CARD_UNFROZEN: card=${card.cardNumber}, by employee ${employeeId}`
  )

  return { success: true, data: updatedCard as unknown as Record<string, unknown> }
}
