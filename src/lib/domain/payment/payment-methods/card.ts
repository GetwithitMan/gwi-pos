/**
 * Card Payment Processing
 *
 * Handles Datacap fields, cardLast4 validation, and SAF status.
 */

import {
  generateFakeAuthCode,
  generateFakeTransactionId,
} from '@/lib/payment'
import { createChildLogger } from '@/lib/logger'
import type { PaymentInput, PaymentRecord } from '../types'

const log = createChildLogger('payment')

/**
 * Process a credit/debit card payment — maps Datacap fields and generates fallback auth codes.
 */
export function processCardPayment(
  payment: PaymentInput,
  record: PaymentRecord,
  orderId: string,
): PaymentRecord {
  // Validate cardLast4 — allow '0000' only for non-card methods (gift card, house account, etc.)
  // For actual credit/debit card payments, a missing cardLast4 likely means the terminal
  // didn't return it. We still allow the payment through (blocking could strand a successful
  // charge) but log a warning so it shows up in monitoring.
  if (!payment.cardLast4 || !/^\d{4}$/.test(payment.cardLast4)) {
    log.warn({ orderId, method: payment.method }, 'Card payment missing cardLast4, defaulting to 0000')
    payment.cardLast4 = '0000'
  }

  // Use real Datacap fields when available, fall back to placeholders
  const isDatacap = !!payment.datacapRecordNo || !!payment.datacapRefNumber
  return {
    ...record,
    cardBrand: payment.cardBrand || 'visa',
    cardLast4: payment.cardLast4,
    authCode: isDatacap ? payment.authCode : generateFakeAuthCode(),
    transactionId: isDatacap ? payment.datacapRefNumber : generateFakeTransactionId(),
    ...(isDatacap && {
      datacapRecordNo: payment.datacapRecordNo,
      datacapRefNumber: payment.datacapRefNumber,
      datacapSequenceNo: payment.datacapSequenceNo,
      entryMethod: payment.entryMethod,
      signatureData: payment.signatureData,
      amountAuthorized: payment.amountAuthorized,
      amountRequested: payment.amount,
      ...(payment.storedOffline && { isOfflineCapture: true }),
      // Datacap processor metadata for chargeback defense + ByRecordNo ops
      acqRefData: payment.acqRefData || null,
      processData: payment.processData || null,
      aid: payment.aid || null,
      cvmResult: payment.cvm ? String(payment.cvm) : null,
      avsResult: payment.avsResult || null,
      level2Status: payment.level2Status || null,
      tokenFrequency: payment.tokenFrequency || 'OneTime',
    }),
    safStatus: payment.storedOffline ? 'APPROVED_SAF_PENDING_UPLOAD' : 'APPROVED_ONLINE',
  }
}
