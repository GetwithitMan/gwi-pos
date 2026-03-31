/**
 * PMS Pre-Charge — Oracle OPERA HTTP call OUTSIDE the transaction.
 *
 * Room charges require a 1-5s HTTP call to Oracle OPERA. Doing this inside the
 * FOR UPDATE transaction lock blocks all other terminals. Instead, we:
 *   1. Validate PMS config and consume the one-time selection token
 *   2. Create a PENDING pmsChargeAttempt record (outside tx -- survives tx rollback)
 *   3. Make the HTTP call to OPERA
 *   4. Pass the result into the transaction, which just records the payment
 *
 * SAFETY: If OPERA succeeds but the DB transaction fails, the pmsChargeAttempt record
 * (status=PENDING) persists for manual reconciliation -- the charge is never silently lost.
 */

import { NextResponse } from 'next/server'
import { parseSettings } from '@/lib/settings'
import { toNumber } from '@/lib/pricing'
import { err, notFound } from '@/lib/api-response'
import type { PmsAttemptStatus } from '@/generated/prisma/client'

export interface PreChargeResult {
  pmsAttemptId: string
  pmsTransactionNo: string
  roomNumber: string
  guestName: string
  reservationId: string
  idempotencyKey: string
}

/**
 * Execute PMS pre-charge if any payment is a room_charge.
 * Returns null if no room charge, or a PreChargeResult on success.
 * Returns a NextResponse early-exit on validation/charge failure.
 */
export async function executePmsPreCharge(
  db: any,
  orderId: string,
  body: Record<string, unknown>,
): Promise<{ result: PreChargeResult } | { earlyReturn: NextResponse } | null> {
  const rawPayments = Array.isArray(body.payments) ? body.payments : []
  const rawMethod = body.paymentMethodId || body.paymentMethod || body.method
  const hasRoomCharge = rawPayments.some((p: any) => p.method === 'room_charge') ||
                        rawMethod === 'room_charge'

  if (!hasRoomCharge) return null

  // Lightweight query for settings -- no FOR UPDATE, no lock
  // eslint-disable-next-line no-restricted-syntax
  const locationForPms = await db.order.findFirst({
    where: { id: orderId },
    select: {
      locationId: true,
      orderNumber: true,
      location: { select: { settings: true } },
    },
  })

  if (!locationForPms) {
    return { earlyReturn: notFound('Order not found') as NextResponse }
  }

  const pmsSettings = parseSettings(locationForPms.location.settings)

  if (!pmsSettings.payments.acceptHotelRoomCharge) {
    return { earlyReturn: err('Bill to Room is not enabled') as NextResponse }
  }

  const pms = pmsSettings.hotelPms
  if (!pms?.enabled || !pms.clientId) {
    return { earlyReturn: err('Oracle PMS integration is not configured') as NextResponse }
  }

  // Find the room_charge payment in the array
  const roomPayment = rawPayments.find((p: any) => p.method === 'room_charge') ||
                      (rawMethod === 'room_charge' ? body : null)
  const selectionId = roomPayment?.selectionId
  if (!selectionId) {
    return { earlyReturn: err('Room charge requires a valid guest selection.') as NextResponse }
  }

  const { consumeRoomChargeSelection } = await import('@/lib/room-charge-selections')
  const sel = consumeRoomChargeSelection(selectionId, locationForPms.locationId)
  if (!sel) {
    return { earlyReturn: err('Guest selection has expired or is invalid. Please look up the guest again.') as NextResponse }
  }

  const amountVal = toNumber(roomPayment.amount || 0)
  const tipVal = toNumber(roomPayment.tipAmount || 0)
  if (!isFinite(amountVal) || amountVal < 0 || !isFinite(tipVal) || tipVal < 0) {
    return { earlyReturn: err('Invalid payment amount') as NextResponse }
  }

  // FIX F10: Only send base amount to OPERA -- tip is recorded on the Payment
  // record but must NOT be added to the PMS folio charge.
  const amountCents = Math.round(amountVal * 100)
  const idempotencyKey_pms = `${orderId}:${sel.reservationId}:${amountCents}:${pms.chargeCode}`

  // Check existing attempt (outside tx -- read-only, safe)
  let pmsAttempt = await db.pmsChargeAttempt.findUnique({ where: { idempotencyKey: idempotencyKey_pms } })

  if (pmsAttempt?.status === 'COMPLETED') {
    return { earlyReturn: NextResponse.json({
      success: true,
      message: 'Room charge already processed.',
      transactionNo: pmsAttempt.operaTransactionId,
    }) }
  }

  if (pmsAttempt?.status === 'FAILED') {
    return { earlyReturn: err('A previous charge attempt failed. Please try a new payment.', 502) as NextResponse }
  }

  if (pmsAttempt?.status === 'PENDING') {
    const ageMs = Date.now() - pmsAttempt.updatedAt.getTime()
    if (ageMs < 60_000) {
      return { earlyReturn: err('Charge in progress. Please wait a moment and try again.', 409) as NextResponse }
    }
  }

  // Create PENDING attempt outside tx -- ensures it survives even if the later tx fails
  if (!pmsAttempt) {
    pmsAttempt = await db.pmsChargeAttempt.create({
      data: {
        idempotencyKey: idempotencyKey_pms,
        locationId: locationForPms.locationId,
        orderId,
        reservationId: sel.reservationId,
        amountCents,
        chargeCode: pms.chargeCode,
        employeeId: sel.employeeId ?? null,
        status: 'PENDING',
      },
    })
  }

  // Make the OPERA HTTP call OUTSIDE the transaction lock
  try {
    const { postCharge } = await import('@/lib/oracle-pms-client')
    const chargeResult = await postCharge(pms, locationForPms.locationId, {
      reservationId: sel.reservationId,
      amountCents,
      description: `Restaurant Charge`,
      reference: `GWI-POS-Order-${locationForPms.orderNumber ?? orderId}`,
      idempotencyKey: pmsAttempt.idempotencyKey,
    })

    return {
      result: {
        pmsAttemptId: pmsAttempt.id,
        pmsTransactionNo: chargeResult.transactionNo,
        roomNumber: sel.roomNumber,
        guestName: sel.guestName,
        reservationId: sel.reservationId,
        idempotencyKey: idempotencyKey_pms,
      },
    }
  } catch (caughtErr) {
    // Mark attempt FAILED for reconciliation
    await db.pmsChargeAttempt.update({
      where: { id: pmsAttempt.id },
      data: {
        status: 'FAILED' as PmsAttemptStatus,
        lastErrorMessage: caughtErr instanceof Error ? caughtErr.message.substring(0, 200) : 'unknown',
      },
    }).catch((e: unknown) => console.error('[pay/room_charge] Failed to mark attempt FAILED:', e))
    console.error('[pay/room_charge] OPERA charge failed:', caughtErr instanceof Error ? caughtErr.message : 'unknown')
    return { earlyReturn: err('Failed to post charge to hotel room. Please verify the room and try again.', 502) as NextResponse }
  }
}
