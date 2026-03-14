/**
 * Loyalty Points Payment Processing
 *
 * Handles points validation, balance check, and deduction.
 */

import type { TxClient, PaymentInput, PaymentRecord } from '../types'

interface LoyaltySettings {
  enabled: boolean
  redemptionEnabled: boolean
  pointsPerDollarRedemption: number
  minimumRedemptionPoints: number
  maximumRedemptionPercent: number
}

interface LoyaltyPaymentResult {
  record: PaymentRecord
  error?: string
  errorStatus?: number
}

/**
 * Process a loyalty points payment — validates points, locks customer, deducts points.
 */
export async function processLoyaltyPayment(
  tx: TxClient,
  payment: PaymentInput,
  record: PaymentRecord,
  orderTotal: number,
  customer: { id: string; loyaltyPoints: number } | null,
  loyaltySettings: LoyaltySettings,
): Promise<LoyaltyPaymentResult> {
  if (!loyaltySettings.enabled || !loyaltySettings.redemptionEnabled) {
    return { record, error: 'Loyalty points redemption is not enabled', errorStatus: 400 }
  }

  if (!customer) {
    return { record, error: 'Customer is required to redeem loyalty points', errorStatus: 400 }
  }

  const pointsNeeded = Math.ceil(payment.amount * loyaltySettings.pointsPerDollarRedemption)

  if (!payment.pointsUsed || payment.pointsUsed < pointsNeeded) {
    return {
      record,
      error: `${pointsNeeded} points required for $${payment.amount.toFixed(2)} redemption`,
      errorStatus: 400,
    }
  }

  if (customer.loyaltyPoints < payment.pointsUsed) {
    return {
      record,
      error: `Insufficient points. Customer has ${customer.loyaltyPoints} points.`,
      errorStatus: 400,
    }
  }

  if (payment.pointsUsed < loyaltySettings.minimumRedemptionPoints) {
    return {
      record,
      error: `Minimum ${loyaltySettings.minimumRedemptionPoints} points required for redemption`,
      errorStatus: 400,
    }
  }

  const maxRedemptionAmount = orderTotal * (loyaltySettings.maximumRedemptionPercent / 100)
  if (payment.amount > maxRedemptionAmount) {
    return {
      record,
      error: `Maximum ${loyaltySettings.maximumRedemptionPercent}% of order can be paid with points`,
      errorStatus: 400,
    }
  }

  const updatedRecord: PaymentRecord = {
    ...record,
    transactionId: `LOYALTY:${payment.pointsUsed}pts`,
  }

  // Re-check balance inside transaction for safety
  const freshCustomer = await tx.customer.findUnique({
    where: { id: customer.id },
    select: { loyaltyPoints: true },
  })
  if (!freshCustomer || freshCustomer.loyaltyPoints < payment.pointsUsed) {
    return {
      record,
      error: `Insufficient points. Customer has ${freshCustomer?.loyaltyPoints ?? 0} points.`,
      errorStatus: 400,
    }
  }

  await tx.customer.update({
    where: { id: customer.id },
    data: {
      loyaltyPoints: { decrement: payment.pointsUsed },
    },
  })

  return { record: updatedRecord }
}
