/**
 * House Account Payment Processing
 *
 * Handles credit limit validation, balance update, and transaction record creation.
 */

import type { TxClient, PaymentInput, PaymentRecord } from '../types'

interface HouseAccountPaymentResult {
  record: PaymentRecord
  error?: string
  errorStatus?: number
  errorExtras?: Record<string, unknown>
}

/**
 * Process a house account payment — validates status/credit, locks account, charges, and creates transaction.
 */
export async function processHouseAccountPayment(
  tx: TxClient,
  payment: PaymentInput,
  record: PaymentRecord,
  orderId: string,
  locationId: string,
  orderNumber: number | null,
  employeeId: string | null,
  acceptHouseAccounts: boolean,
): Promise<HouseAccountPaymentResult> {
  if (!acceptHouseAccounts) {
    return { record, error: 'House accounts are not accepted', errorStatus: 400 }
  }

  if (!payment.houseAccountId) {
    return { record, error: 'House account ID is required', errorStatus: 400 }
  }

  const haPaymentAmount = payment.amount + (payment.tipAmount || 0)

  // C3: Acquire row lock on house account to prevent balance race condition.
  await tx.$queryRawUnsafe(
    `SELECT id FROM "HouseAccount" WHERE id = $1 FOR UPDATE`,
    payment.houseAccountId,
  )

  const freshAccount = await tx.houseAccount.findUnique({
    where: { id: payment.houseAccountId }
  })

  if (!freshAccount) {
    return { record, error: 'House account not found', errorStatus: 404 }
  }

  if (freshAccount.status === 'pending') {
    return { record, error: 'House account not yet activated', errorStatus: 400 }
  }

  if (freshAccount.status !== 'active') {
    return { record, error: `House account is ${freshAccount.status}`, errorStatus: 400 }
  }

  const haCurrentBalance = Number(freshAccount.currentBalance)
  const haCreditLimit = Number(freshAccount.creditLimit)
  const haNewBalance = haCurrentBalance + haPaymentAmount

  if (haCreditLimit > 0 && haNewBalance > haCreditLimit) {
    return {
      record,
      error: 'Charge would exceed credit limit',
      errorStatus: 400,
      errorExtras: {
        currentBalance: haCurrentBalance,
        creditLimit: haCreditLimit,
        availableCredit: Math.max(0, haCreditLimit - haCurrentBalance),
      },
    }
  }

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + (freshAccount.paymentTerms ?? 30))

  await tx.houseAccount.update({
    where: { id: freshAccount.id },
    data: {
      currentBalance: { increment: haPaymentAmount },
      transactions: {
        create: {
          locationId,
          type: 'charge',
          amount: haPaymentAmount,
          balanceBefore: haCurrentBalance,
          balanceAfter: haNewBalance,
          orderId,
          employeeId,
          notes: `Order #${orderNumber}`,
          dueDate,
        }
      }
    }
  })

  return {
    record: {
      ...record,
      transactionId: `HA:${freshAccount.id}`,
      authCode: freshAccount.name,
    },
  }
}
