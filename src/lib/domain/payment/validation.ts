/**
 * Payment Validation
 *
 * Zod schemas and idempotency checks for payment requests.
 */

import { z } from 'zod'

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const PaymentInputSchema = z.object({
  method: z.enum(['cash', 'credit', 'debit', 'gift_card', 'house_account', 'loyalty_points', 'room_charge']),
  amount: z.number().positive('Amount must be positive').max(999999.99, 'Amount cannot exceed $999,999.99').finite('Amount must be a finite number'),
  tipAmount: z.number().min(0, 'Tip amount cannot be negative').max(99999.99, 'Tip cannot exceed $99,999.99').finite('Tip must be a finite number').optional(),
  // Cash specific
  amountTendered: z.number().positive().optional(),
  // Card specific
  cardBrand: z.string().optional(),
  cardLast4: z.string().length(4, 'Card last 4 must be exactly 4 digits').regex(/^\d{4}$/, 'Card last 4 must be numeric').optional(),
  // Gift card specific
  giftCardId: z.string().optional(),
  giftCardNumber: z.string().optional(),
  // House account specific
  houseAccountId: z.string().optional(),
  // Hotel PMS / Bill to Room fields (P1.1: client sends selectionId, not raw OPERA IDs)
  selectionId: z.string().optional(),
  roomNumber: z.string().optional(),
  guestName: z.string().optional(),
  pmsReservationId: z.string().optional(),
  // Loyalty points specific
  pointsUsed: z.number().int().positive().optional(),
  // Datacap Direct fields
  datacapRecordNo: z.string().optional(),
  datacapRefNumber: z.string().optional(),
  datacapSequenceNo: z.string().optional(),
  authCode: z.string().optional(),
  entryMethod: z.string().optional(),
  signatureData: z.string().optional(),
  amountAuthorized: z.number().positive().optional(),
  // Datacap processor metadata for ByRecordNo ops + chargeback defense
  acqRefData: z.string().optional(),
  processData: z.string().optional(),
  aid: z.string().optional(),
  cvm: z.string().optional(),
  avsResult: z.string().optional(),
  level2Status: z.string().optional(),
  tokenFrequency: z.string().optional(),
  // SAF (Store-and-Forward) — transaction stored offline on reader, pending upload
  storedOffline: z.boolean().optional(),
})

// PAYMENT-SAFETY: Idempotency design
// - idempotencyKey is optional in the schema because some clients (legacy, mobile) may not send it.
// - Server generates a fallback UUID when missing (line below: `finalIdempotencyKey`).
// - The duplicate check only fires when the CLIENT sends a key, because a server-generated UUID
//   is unique per request and can never match an existing payment.
// - For true double-charge prevention, the client MUST generate a UUID on button press and resend
//   the same key on retries. The PaymentModal already does this.
export const PaymentRequestSchema = z.object({
  payments: z.array(PaymentInputSchema).min(1, 'At least one payment is required'),
  employeeId: z.string().optional(),
  terminalId: z.string().optional(),
  idempotencyKey: z.string().optional(),
})

// ─── Idempotency Check ─────────────────────────────────────────────────────

export interface IdempotencyCheckResult {
  isDuplicate: true
  response: {
    payments: Array<{
      id: string
      method: string
      amount: number
      tipAmount: number
      totalAmount: number
      status: string
    }>
    orderStatus: string
  }
}

/**
 * Check if a payment request is a duplicate by idempotencyKey.
 * Uses already-loaded order payments (no extra query).
 */
export function checkIdempotencyByKey(
  idempotencyKey: string | undefined,
  existingPayments: Array<{
    id: string
    idempotencyKey: string | null
    status: string
    paymentMethod: string
    amount: unknown
    tipAmount: unknown
    totalAmount: unknown
  }>,
  orderStatus: string,
): IdempotencyCheckResult | null {
  if (!idempotencyKey) return null

  const duplicatePayments = existingPayments.filter(
    p => p.idempotencyKey === idempotencyKey && p.status === 'completed'
  )
  if (duplicatePayments.length === 0) return null

  return {
    isDuplicate: true,
    response: {
      payments: duplicatePayments.map(p => ({
        id: p.id,
        method: p.paymentMethod,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        totalAmount: Number(p.totalAmount),
        status: p.status,
      })),
      orderStatus: orderStatus || 'unknown',
    },
  }
}

/**
 * Check if a payment with the same Datacap recordNo already exists.
 * RecordNo-based idempotency for PaymentReconciliationWorker.
 */
export function checkIdempotencyByRecordNo(
  recordNo: string | undefined,
  existingPayments: Array<{
    id: string
    datacapRecordNo: string | null
    status: string
  }>,
): { existingPaymentId: string } | null {
  if (!recordNo) return null

  const existing = existingPayments.find(
    p => p.datacapRecordNo === recordNo && p.status === 'completed'
  )
  if (!existing) return null

  return { existingPaymentId: existing.id }
}

/**
 * Validate that tip amounts are not unreasonably large (> 500% of payment).
 */
export function validateTipBounds(
  payments: Array<{ amount: number; tipAmount?: number }>,
): string | null {
  for (const payment of payments) {
    if (payment.tipAmount && payment.tipAmount > payment.amount * 5) {
      return 'Tip amount cannot exceed 500% of payment amount'
    }
  }
  return null
}

/**
 * Validate payment amounts are reasonable and Datacap fields are consistent.
 */
export function validatePaymentAmounts(
  payments: Array<{
    method: string
    amount: number
    tipAmount?: number
    datacapRecordNo?: string
    datacapRefNumber?: string
    datacapSequenceNo?: string
    entryMethod?: string
    signatureData?: string
    amountAuthorized?: number
    cardLast4?: string
  }>,
  orderTotal: number,
): string | null {
  for (const payment of payments) {
    const paymentAmount = payment.amount + (payment.tipAmount || 0)

    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return `Invalid payment amount: ${paymentAmount}. Amount must be a positive number.`
    }

    // Prevent unreasonably large payments (potential UI bugs)
    const maxReasonablePayment = orderTotal * 1.5
    if (paymentAmount > maxReasonablePayment) {
      return `Payment amount $${paymentAmount.toFixed(2)} exceeds reasonable limit (150% of order total). This may indicate an error.`
    }

    // Validate Datacap field mutual exclusivity for card payments
    if (payment.method === 'credit' || payment.method === 'debit') {
      const hasAnyDatacapField = !!(
        payment.datacapRecordNo ||
        payment.datacapRefNumber ||
        payment.datacapSequenceNo ||
        payment.entryMethod ||
        payment.signatureData ||
        payment.amountAuthorized
      )

      const hasAllRequiredDatacapFields = !!(
        payment.datacapRecordNo &&
        payment.datacapRefNumber &&
        payment.cardLast4
      )

      if (hasAnyDatacapField && !hasAllRequiredDatacapFields) {
        return 'Partial Datacap data detected. Card payments must have either all Datacap fields (RecordNo, RefNumber, CardLast4) or none. This indicates a corrupted payment record.'
      }
    }
  }

  return null
}
