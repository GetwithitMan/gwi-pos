/**
 * Gift Card Payment Processing
 *
 * Handles balance check, row lock, deduction, and transaction record creation.
 */

import type { TxClient, PaymentInput, PaymentRecord } from '../types'

interface GiftCardPaymentResult {
  record: PaymentRecord
  error?: string
  errorStatus?: number
  errorExtras?: Record<string, unknown>
}

/**
 * Process a gift card payment — validates balance, locks card, deducts, and creates transaction.
 */
export async function processGiftCardPayment(
  tx: TxClient,
  payment: PaymentInput,
  record: PaymentRecord,
  orderId: string,
  locationId: string,
  orderNumber: number | null,
  employeeId: string | null,
  acceptGiftCards: boolean,
): Promise<GiftCardPaymentResult> {
  if (!acceptGiftCards) {
    return { record, error: 'Gift cards are not accepted', errorStatus: 400 }
  }

  const giftCardLookup = payment.giftCardId || payment.giftCardNumber
  if (!giftCardLookup) {
    return { record, error: 'Gift card ID or number is required', errorStatus: 400 }
  }

  let giftCard = await tx.giftCard.findUnique({
    where: { id: payment.giftCardId || '' }
  })

  if (!giftCard && payment.giftCardNumber) {
    giftCard = await tx.giftCard.findUnique({
      where: { cardNumber: payment.giftCardNumber.toUpperCase() }
    })
  }

  if (!giftCard) {
    return { record, error: 'Gift card not found', errorStatus: 404 }
  }

  // C3: Acquire row lock on gift card to prevent balance race condition.
  await tx.$queryRawUnsafe(
    `SELECT id FROM "GiftCard" WHERE id = $1 FOR UPDATE`,
    giftCard.id,
  )
  // Re-read with fresh balance after acquiring lock
  const freshGiftCard = await tx.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } })
  giftCard = freshGiftCard

  if (giftCard.status !== 'active') {
    return { record, error: `Gift card is ${giftCard.status}`, errorStatus: 400 }
  }

  if (giftCard.expiresAt && new Date() > giftCard.expiresAt) {
    await tx.giftCard.update({
      where: { id: giftCard.id },
      data: { status: 'expired' }
    })
    return { record, error: 'Gift card has expired', errorStatus: 400 }
  }

  const cardBalance = Number(giftCard.currentBalance)
  const gcPaymentAmount = payment.amount + (payment.tipAmount || 0)

  if (cardBalance < gcPaymentAmount) {
    return {
      record,
      error: `Insufficient gift card balance ($${cardBalance.toFixed(2)})`,
      errorStatus: 400,
      errorExtras: { currentBalance: cardBalance },
    }
  }

  const newBalance = cardBalance - gcPaymentAmount

  const updatedRecord: PaymentRecord = {
    ...record,
    transactionId: `GC:${giftCard.cardNumber}`,
    cardLast4: giftCard.cardNumber.slice(-4),
  }

  await tx.giftCard.update({
    where: { id: giftCard.id },
    data: {
      currentBalance: { decrement: gcPaymentAmount },
      status: newBalance === 0 ? 'depleted' : 'active',
      transactions: {
        create: {
          locationId,
          type: 'redemption',
          amount: -gcPaymentAmount,
          balanceBefore: cardBalance,
          balanceAfter: newBalance,
          orderId,
          employeeId,
          notes: `Payment for order #${orderNumber}`,
        }
      }
    }
  })

  return { record: updatedRecord }
}
