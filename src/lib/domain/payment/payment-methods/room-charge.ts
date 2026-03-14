/**
 * Room Charge Payment Processing
 *
 * Applies pre-charge result to payment record.
 * NOTE: The actual OPERA HTTP call stays in the route (infrastructure).
 */

import type { PaymentRecord } from '../types'

export interface PreChargeResult {
  pmsAttemptId: string
  pmsTransactionNo: string
  roomNumber: string
  guestName: string
  reservationId: string
  idempotencyKey: string
}

interface RoomChargePaymentResult {
  record: PaymentRecord
  pmsAttemptId: string
  pmsTransactionNo: string
  error?: string
  errorStatus?: number
}

/**
 * Process a room charge payment — applies pre-fetched PMS charge result to the payment record.
 * The actual OPERA HTTP call was already executed outside the transaction.
 */
export function processRoomChargePayment(
  record: PaymentRecord,
  preChargeResult: PreChargeResult | null,
): RoomChargePaymentResult {
  if (!preChargeResult) {
    return {
      record,
      pmsAttemptId: '',
      pmsTransactionNo: '',
      error: 'Internal error: PMS pre-charge result missing.',
      errorStatus: 500,
    }
  }

  return {
    record: {
      ...record,
      roomNumber: preChargeResult.roomNumber,
      guestName: preChargeResult.guestName,
      pmsReservationId: preChargeResult.reservationId,
      pmsTransactionId: preChargeResult.pmsTransactionNo,
      transactionId: `PMS:${preChargeResult.pmsTransactionNo}`,
      authCode: `Room ${preChargeResult.roomNumber}`,
    },
    pmsAttemptId: preChargeResult.pmsAttemptId,
    pmsTransactionNo: preChargeResult.pmsTransactionNo,
  }
}
