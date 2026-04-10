/**
 * Payment Request Normalization
 *
 * Pre-transaction phase extracted from the pay route.
 * Runs BEFORE db.$transaction — handles body parsing, order claim check,
 * permission pre-checks, and PMS (OPERA) pre-charge.
 *
 * No FOR UPDATE lock held during this phase.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { PrismaClient, PmsAttemptStatus } from '@/generated/prisma/client'
import { parseSettings } from '@/lib/settings'
import { requireAnyPermission, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { toNumber } from '@/lib/pricing'
import { checkOrderClaim } from '@/lib/order-claim'
import { getRequestLocationId } from '@/lib/request-context'
import { err, notFound, ok } from '@/lib/api-response'
import type { PreChargeResult } from '../payment-methods'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PaymentRequestContext {
  body: Record<string, unknown>
  preChargeResult: PreChargeResult | null
  rawPayments: Array<Record<string, unknown>>
}

type NormalizeResult =
  | { ok: true; ctx: PaymentRequestContext }
  | { ok: false; response: NextResponse }

// ─── Main Function ─────────────────────────────────────────────────────────

export async function normalizePaymentRequest(params: {
  request: NextRequest
  orderId: string
  db: PrismaClient
}): Promise<NormalizeResult> {
  const { request, orderId, db } = params

  // ── 1. Body parsing ───────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return { ok: false, response: err('Invalid JSON body') }
  }

  // ── 2. Order claim check — block if another employee has an active claim ──
  const payEmployeeId = (body.employeeId as string) || null
  if (payEmployeeId) {
    const terminalId = request.headers.get('x-terminal-id') || (body.terminalId as string) || null
    const claimBlock = await checkOrderClaim(db, orderId, payEmployeeId, terminalId)
    if (claimBlock) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: claimBlock.error, claimedBy: claimBlock.claimedBy },
          { status: claimBlock.status }
        ),
      }
    }
  }

  // ── 3. Permission pre-checks OUTSIDE the transaction (no FOR UPDATE needed) ──
  // These calls hit the auth service / employee table, not the Order row.
  // Running them before the lock reduces contention time.
  // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
  let payLocationId = getRequestLocationId()
  let preCheckOrder: { locationId: string; employeeId: string | null } | null = null
  if (payLocationId) {
    // We have locationId but still need employeeId for ownership check
    const orderOwner = await db.order.findFirst({
      where: { id: orderId },
      select: { employeeId: true },
    })
    preCheckOrder = orderOwner ? { locationId: payLocationId, employeeId: orderOwner.employeeId } : null
  } else {
    preCheckOrder = await db.order.findFirst({
      where: { id: orderId },
      select: { locationId: true, employeeId: true },
    })
    payLocationId = preCheckOrder?.locationId
  }
  if (preCheckOrder && payEmployeeId) {
    // Normalize payment methods from the raw body for permission resolution
    const rawPaymentsForPerms = Array.isArray(body.payments)
      ? body.payments
      : [{ method: body.paymentMethodId || body.paymentMethod || body.method || 'cash' }]
    const requiredPermsPreCheck = new Set<string>()
    for (const p of rawPaymentsForPerms) {
      if ((p as any).method === 'cash') {
        requiredPermsPreCheck.add(PERMISSIONS.POS_CASH_PAYMENTS)
      } else {
        requiredPermsPreCheck.add(PERMISSIONS.POS_CARD_PAYMENTS)
      }
    }
    const authPreCheck = await requireAnyPermission(payEmployeeId, preCheckOrder.locationId, [...requiredPermsPreCheck])
    if (!authPreCheck.authorized) {
      return { ok: false, response: err(authPreCheck.error, authPreCheck.status) }
    }
    // Guard: paying another employee's order requires pos.edit_others_orders
    if (preCheckOrder.employeeId && preCheckOrder.employeeId !== payEmployeeId) {
      const ownerAuthPreCheck = await requirePermission(payEmployeeId, preCheckOrder.locationId, PERMISSIONS.POS_EDIT_OTHERS_ORDERS)
      if (!ownerAuthPreCheck.authorized) {
        return { ok: false, response: err(ownerAuthPreCheck.error, ownerAuthPreCheck.status) }
      }
    }
  }

  // ── 4. PMS Pre-Charge: Extract Oracle OPERA HTTP call OUTSIDE the transaction ──
  // Room charges require a 1-5s HTTP call to Oracle OPERA. Doing this inside the
  // FOR UPDATE transaction lock blocks all other terminals. Instead, we:
  //   1. Validate PMS config and consume the one-time selection token
  //   2. Create a PENDING pmsChargeAttempt record (outside tx — survives tx rollback for reconciliation)
  //   3. Make the HTTP call to OPERA
  //   4. Pass the result into the transaction, which just records the payment
  // SAFETY: If OPERA succeeds but the DB transaction fails, the pmsChargeAttempt record
  // (status=PENDING) persists for manual reconciliation — the charge is never silently lost.
  let preChargeResult: PreChargeResult | null = null

  // Detect room_charge in payments array (handle both normalized and raw formats)
  const rawPayments = Array.isArray(body.payments) ? body.payments as Array<Record<string, unknown>> : []
  const rawMethod = body.paymentMethodId || body.paymentMethod || body.method
  const hasRoomCharge = rawPayments.some((p: any) => p.method === 'room_charge') ||
                        rawMethod === 'room_charge'

  if (hasRoomCharge) {
    // Lightweight query for settings — no FOR UPDATE, no lock
    // NOTE: Uses db directly because this runs before the main transaction and locationId
    // may not be available yet (preCheckOrder could be null if room_charge is the only payment type).
    const locationForPms = await db.order.findFirst({
      where: { id: orderId },
      select: {
        locationId: true,
        orderNumber: true,
        location: { select: { settings: true } },
      },
    })

    if (!locationForPms) {
      return { ok: false, response: notFound('Order not found') }
    }

    const pmsSettings = parseSettings(locationForPms.location.settings)

    if (!pmsSettings.payments.acceptHotelRoomCharge) {
      return { ok: false, response: err('Bill to Room is not enabled') }
    }

    const pms = pmsSettings.hotelPms
    if (!pms?.enabled || !pms.clientId) {
      return { ok: false, response: err('Oracle PMS integration is not configured') }
    }

    // Find the room_charge payment in the array
    const roomPayment = rawPayments.find((p: any) => p.method === 'room_charge') ||
                        (rawMethod === 'room_charge' ? body : null)
    const selectionId = (roomPayment as any)?.selectionId
    if (!selectionId) {
      return { ok: false, response: err('Room charge requires a valid guest selection.') }
    }

    const { consumeRoomChargeSelection } = await import('@/lib/room-charge-selections')
    const sel = consumeRoomChargeSelection(selectionId, locationForPms.locationId)
    if (!sel) {
      return { ok: false, response: err('Guest selection has expired or is invalid. Please look up the guest again.') }
    }

    const amountVal = toNumber((roomPayment as any).amount || 0)
    const tipVal = toNumber((roomPayment as any).tipAmount || 0)
    if (!isFinite(amountVal) || amountVal < 0 || !isFinite(tipVal) || tipVal < 0) {
      return { ok: false, response: err('Invalid payment amount') }
    }
    // FIX F10: Only send base amount to OPERA — tip is recorded on the Payment
    // record but must NOT be added to the PMS folio charge (prevents guest overcharge).
    const amountCents = Math.round(amountVal * 100)
    const idempotencyKey_pms = `${orderId}:${sel.reservationId}:${amountCents}:${pms.chargeCode}`

    // Check existing attempt (outside tx — read-only, safe)
    let pmsAttempt = await db.pmsChargeAttempt.findUnique({ where: { idempotencyKey: idempotencyKey_pms } })

    if (pmsAttempt?.status === 'COMPLETED') {
      return {
        ok: false,
        response: ok({
          success: true,
          message: 'Room charge already processed.',
          transactionNo: pmsAttempt.operaTransactionId,
        }),
      }
    }

    if (pmsAttempt?.status === 'FAILED') {
      return { ok: false, response: err('A previous charge attempt failed. Please try a new payment.', 502) }
    }

    if (pmsAttempt?.status === 'PENDING') {
      const ageMs = Date.now() - pmsAttempt.updatedAt.getTime()
      if (ageMs < 60_000) {
        return { ok: false, response: err('Charge in progress. Please wait a moment and try again.', 409) }
      }
    }

    // Create PENDING attempt outside tx — ensures it survives even if the later tx fails
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

    // ── Make the OPERA HTTP call OUTSIDE the transaction lock ──
    try {
      const { postCharge } = await import('@/lib/oracle-pms-client')
      const chargeResult = await postCharge(pms, locationForPms.locationId, {
        reservationId: sel.reservationId,
        amountCents,
        description: `Restaurant Charge`,
        reference: `GWI-POS-Order-${locationForPms.orderNumber ?? orderId}`,
        idempotencyKey: pmsAttempt.idempotencyKey,
      })

      preChargeResult = {
        pmsAttemptId: pmsAttempt.id,
        pmsTransactionNo: chargeResult.transactionNo,
        roomNumber: sel.roomNumber,
        guestName: sel.guestName,
        reservationId: sel.reservationId,
        idempotencyKey: idempotencyKey_pms,
      }
    } catch (caughtErr) {
      // Mark attempt FAILED for reconciliation
      await db.pmsChargeAttempt.update({
        where: { id: pmsAttempt.id },
        data: {
          status: 'FAILED' as PmsAttemptStatus,
          lastErrorMessage: caughtErr instanceof Error ? caughtErr.message.substring(0, 200) : 'unknown',
        },
      }).catch(e => console.error('[pay/room_charge] Failed to mark attempt FAILED:', e))
      console.error('[pay/room_charge] OPERA charge failed:', caughtErr instanceof Error ? caughtErr.message : 'unknown')
      return { ok: false, response: err('Failed to post charge to hotel room. Please verify the room and try again.', 502) }
    }
  }

  return {
    ok: true,
    ctx: {
      body,
      preChargeResult,
      rawPayments: rawPayments as Array<Record<string, unknown>>,
    },
  }
}
