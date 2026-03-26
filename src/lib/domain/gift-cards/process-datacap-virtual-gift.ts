/**
 * Process Datacap Virtual Gift Webhook
 *
 * Domain command that creates a GiftCard from a Datacap Virtual Gift webhook payload.
 * These are gift cards purchased through an external Datacap-hosted storefront
 * and pushed to the POS via webhook.
 *
 * - Creates card with source: 'datacap_virtual'
 * - Sets lastMutatedBy: 'cloud' (webhook-originated)
 * - Creates a 'purchased' transaction with performedByType: 'webhook'
 * - Sets deliveryStatus: 'pending' for email delivery
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { Prisma } from '@/generated/prisma/client'

interface DatacapVirtualGiftPayload {
  locationId: string
  giftCardNumber: string
  giftCardBalance: number
  recipientName?: string
  recipientEmail?: string
  recipientPhone?: string
  purchaserName?: string
  message?: string
  transactionId: string
  pageId?: string
}

interface ProcessResult {
  success: boolean
  data?: {
    giftCard: Record<string, unknown>
    transaction: Record<string, unknown>
  }
  error?: string
}

export async function processDcVirtualGiftWebhook(
  tx: PrismaClient,
  payload: DatacapVirtualGiftPayload
): Promise<ProcessResult> {
  const {
    locationId,
    giftCardNumber,
    giftCardBalance,
    recipientName,
    recipientEmail,
    recipientPhone,
    purchaserName,
    message,
    transactionId,
    pageId,
  } = payload

  if (!locationId || !giftCardNumber || !transactionId) {
    return { success: false, error: 'Missing required fields: locationId, giftCardNumber, transactionId' }
  }

  if (!giftCardBalance || giftCardBalance <= 0) {
    return { success: false, error: 'Gift card balance must be positive' }
  }

  // Check for duplicate webhook (idempotency via externalTransactionId)
  const existing = await tx.giftCard.findFirst({
    where: {
      externalProvider: 'datacap_virtual_gift',
      externalTransactionId: transactionId,
    },
  })

  if (existing) {
    return { success: false, error: `Duplicate webhook: gift card already exists for transactionId ${transactionId}` }
  }

  const decimalBalance = new Prisma.Decimal(giftCardBalance)
  const cardNumber = giftCardNumber.trim().toUpperCase()

  // Check for card number collision
  const collision = await tx.giftCard.findUnique({ where: { cardNumber } })
  if (collision) {
    return { success: false, error: `Card number ${cardNumber} already exists` }
  }

  const giftCard = await tx.giftCard.create({
    data: {
      locationId,
      cardNumber,
      initialBalance: decimalBalance,
      currentBalance: decimalBalance,
      status: 'active',
      source: 'datacap_virtual',
      lastMutatedBy: 'cloud',
      externalProvider: 'datacap_virtual_gift',
      externalTransactionId: transactionId,
      externalPageId: pageId || null,
      recipientName: recipientName || null,
      recipientEmail: recipientEmail || null,
      recipientPhone: recipientPhone || null,
      purchaserName: purchaserName || null,
      message: message || null,
      deliveryStatus: 'pending',
      transactions: {
        create: {
          locationId,
          type: 'purchased',
          amount: decimalBalance,
          balanceBefore: new Prisma.Decimal(0),
          balanceAfter: decimalBalance,
          notes: 'Purchased via Datacap Virtual Gift storefront',
          performedByType: 'webhook',
          externalReference: transactionId,
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
    `[AUDIT] DATACAP_VIRTUAL_GIFT: card=${cardNumber}, balance=$${decimalBalance.toFixed(2)}, txnId=${transactionId}, location=${locationId}`
  )

  return {
    success: true,
    data: {
      giftCard: giftCard as unknown as Record<string, unknown>,
      transaction: (giftCard.transactions[0] || {}) as unknown as Record<string, unknown>,
    },
  }
}
