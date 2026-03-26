/**
 * Activate Gift Card
 *
 * Domain command for activating an unactivated (pooled) gift card.
 * Sets initial/current balance, status to 'active', records the activation transaction.
 *
 * - Card MUST be in 'unactivated' status
 * - Sets deliveryStatus to 'pending' if recipientEmail is provided
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { Prisma } from '@/generated/prisma/client'

interface ActivateOpts {
  recipientName?: string
  recipientEmail?: string
  recipientPhone?: string
  purchaserName?: string
  message?: string
}

interface ActivateResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

export async function activateGiftCard(
  tx: PrismaClient,
  cardId: string,
  amount: number,
  employeeId: string,
  opts?: ActivateOpts
): Promise<ActivateResult> {
  const card = await tx.giftCard.findUnique({ where: { id: cardId } })
  if (!card) {
    return { success: false, error: 'Gift card not found' }
  }

  if (card.status !== 'unactivated') {
    return { success: false, error: `Card is already ${card.status}. Only unactivated cards can be activated.` }
  }

  const decimalAmount = new Prisma.Decimal(amount)
  const balanceBefore = new Prisma.Decimal(0)

  const updateData: Record<string, unknown> = {
    initialBalance: decimalAmount,
    currentBalance: decimalAmount,
    status: 'active',
    activatedAt: new Date(),
    activatedById: employeeId,
  }

  // Set recipient/purchaser info if provided
  if (opts?.recipientName) updateData.recipientName = opts.recipientName
  if (opts?.recipientEmail) updateData.recipientEmail = opts.recipientEmail
  if (opts?.recipientPhone) updateData.recipientPhone = opts.recipientPhone
  if (opts?.purchaserName) updateData.purchaserName = opts.purchaserName
  if (opts?.message) updateData.message = opts.message

  // Set delivery status to pending if recipient email provided
  if (opts?.recipientEmail) {
    updateData.deliveryStatus = 'pending'
  }

  const updatedCard = await tx.giftCard.update({
    where: { id: cardId },
    data: {
      ...updateData,
      transactions: {
        create: {
          locationId: card.locationId,
          type: 'activated',
          amount: decimalAmount,
          balanceBefore,
          balanceAfter: decimalAmount,
          employeeId,
          notes: `Activated with $${amount.toFixed(2)} balance`,
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
    `[AUDIT] GIFT_CARD_ACTIVATED: card=${card.cardNumber}, balance=$${decimalAmount.toFixed(2)}, by employee ${employeeId}`
  )

  return { success: true, data: updatedCard as unknown as Record<string, unknown> }
}
