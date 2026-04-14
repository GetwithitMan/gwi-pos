// build-bust: v2.0.25
import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { PmsAttemptStatus } from '@/generated/prisma/client'
import { parseSettings } from '@/lib/settings'
import { requireAnyPermission, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { roundToCents, toNumber } from '@/lib/pricing'
import { withVenue } from '@/lib/with-venue'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { ingestAndProject } from '@/lib/order-events/ingester'
import { enableSyncReplication } from '@/lib/db-helpers'
import { checkOrderClaim } from '@/lib/order-claim'
import { PAYABLE_STATUSES } from '@/lib/domain/order-status'
import { getRequestLocationId } from '@/lib/request-context'
import {
  PaymentRequestSchema,
  normalizePaymentInput,
  buildPaymentFinancialContext,
  checkIdempotencyByKey,
  checkIdempotencyByRecordNo,
  validateTipBounds,
  processPaymentLoop,
  commitPaymentTransaction,
  buildReceiptData,
  type PaymentInput,
  type PaymentRecord,
} from '@/lib/domain/payment'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
import { handlePaymentFailure } from '@/lib/domain/payment/compensation/handle-payment-failure'
import { runPaymentPostCommitEffects } from '@/lib/domain/payment/effects/run-payment-post-commit-effects'
const log = createChildLogger('orders-pay')

// POST - Process payment for order
export const POST = withVenue(withTiming(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params
  const timing = getTimingFromRequest(request)
  let body: Record<string, unknown> = {}
  let autoVoidRecords: PaymentRecord[] = []
  let autoVoidTerminalId: string | undefined
  let autoVoidLocationId: string | undefined
  let pendingCaptureIdempotencyKey: string | undefined
  try {
    body = await request.json()

    // Order claim check — block if another employee has an active claim
    const payEmployeeId = (body.employeeId as string) || null
    if (payEmployeeId) {
      const terminalId = request.headers.get('x-terminal-id') || (body.terminalId as string) || null
      const claimBlock = await checkOrderClaim(db, orderId, payEmployeeId, terminalId)
      if (claimBlock) {
        return NextResponse.json(
          { error: claimBlock.error, claimedBy: claimBlock.claimedBy },
          { status: claimBlock.status }
        )
      }
    }

    // ── Permission checks OUTSIDE the transaction (no FOR UPDATE needed) ──
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
        return err(authPreCheck.error, authPreCheck.status)
      }
      // Guard: paying another employee's order requires pos.edit_others_orders
      if (preCheckOrder.employeeId && preCheckOrder.employeeId !== payEmployeeId) {
        const ownerAuthPreCheck = await requirePermission(payEmployeeId, preCheckOrder.locationId, PERMISSIONS.POS_EDIT_OTHERS_ORDERS)
        if (!ownerAuthPreCheck.authorized) {
          return err(ownerAuthPreCheck.error, ownerAuthPreCheck.status)
        }
      }
    }

    // ── PMS Pre-Charge: Extract Oracle OPERA HTTP call OUTSIDE the transaction ──
    // Room charges require a 1-5s HTTP call to Oracle OPERA. Doing this inside the
    // FOR UPDATE transaction lock blocks all other terminals. Instead, we:
    //   1. Validate PMS config and consume the one-time selection token
    //   2. Create a PENDING pmsChargeAttempt record (outside tx — survives tx rollback for reconciliation)
    //   3. Make the HTTP call to OPERA
    //   4. Pass the result into the transaction, which just records the payment
    // SAFETY: If OPERA succeeds but the DB transaction fails, the pmsChargeAttempt record
    // (status=PENDING) persists for manual reconciliation — the charge is never silently lost.
    let preChargeResult: {
      pmsAttemptId: string
      pmsTransactionNo: string
      roomNumber: string
      guestName: string
      reservationId: string
      idempotencyKey: string
    } | null = null

    // Detect room_charge in payments array (handle both normalized and raw formats)
    const rawPayments = Array.isArray(body.payments) ? body.payments : []
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
        return notFound('Order not found')
      }

      const pmsSettings = parseSettings(locationForPms.location.settings)

      if (!pmsSettings.payments.acceptHotelRoomCharge) {
        return err('Bill to Room is not enabled')
      }

      const pms = pmsSettings.hotelPms
      if (!pms?.enabled || !pms.clientId) {
        return err('Oracle PMS integration is not configured')
      }

      // Find the room_charge payment in the array
      const roomPayment = rawPayments.find((p: any) => p.method === 'room_charge') ||
                          (rawMethod === 'room_charge' ? body : null)
      const selectionId = roomPayment?.selectionId
      if (!selectionId) {
        return err('Room charge requires a valid guest selection.')
      }

      const { consumeRoomChargeSelection } = await import('@/lib/room-charge-selections')
      const sel = consumeRoomChargeSelection(selectionId, locationForPms.locationId)
      if (!sel) {
        return err('Guest selection has expired or is invalid. Please look up the guest again.')
      }

      const amountVal = toNumber(roomPayment.amount || 0)
      const tipVal = toNumber(roomPayment.tipAmount || 0)
      if (!isFinite(amountVal) || amountVal < 0 || !isFinite(tipVal) || tipVal < 0) {
        return err('Invalid payment amount')
      }
      // FIX F10: Only send base amount to OPERA — tip is recorded on the Payment
      // record but must NOT be added to the PMS folio charge (prevents guest overcharge).
      const amountCents = Math.round(amountVal * 100)
      const idempotencyKey_pms = `${orderId}:${sel.reservationId}:${amountCents}:${pms.chargeCode}`

      // Check existing attempt (outside tx — read-only, safe)
      let pmsAttempt = await db.pmsChargeAttempt.findUnique({ where: { idempotencyKey: idempotencyKey_pms } })

      if (pmsAttempt?.status === 'COMPLETED') {
        return ok({
          success: true,
          message: 'Room charge already processed.',
          transactionNo: pmsAttempt.operaTransactionId,
        })
      }

      if (pmsAttempt?.status === 'FAILED') {
        return err('A previous charge attempt failed. Please try a new payment.', 502)
      }

      if (pmsAttempt?.status === 'PENDING') {
        const ageMs = Date.now() - pmsAttempt.updatedAt.getTime()
        if (ageMs < 60_000) {
          return err('Charge in progress. Please wait a moment and try again.', 409)
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
            lastErrorMessage: err instanceof Error ? err.message.substring(0, 200) : 'unknown',
          },
        }).catch(e => console.error('[pay/room_charge] Failed to mark attempt FAILED:', e))
        console.error('[pay/room_charge] OPERA charge failed:', err instanceof Error ? err.message : 'unknown')
        return err('Failed to post charge to hotel room. Please verify the room and try again.', 502)
      }
    }

    // ── Pre-warm snapshot cache OUTSIDE the FOR UPDATE lock ──────────
    // Running ingestAndProject with an empty event array forces a snapshot
    // replay and caches the result. When the transaction re-enters
    // ingestAndProject later, it hits the cache (incremental path) instead
    // of replaying all events under the row-level lock — saving 50-200ms
    // of lock hold time on large pizza orders with many modifiers.
    if (payLocationId) {
      await ingestAndProject(db, orderId, payLocationId, [], { suppressBroadcast: true })
    }

    // Hoisted for post-transaction access (populated inside tx)
    let loyaltyTierMultiplier: number = 1.0

    const txResult = await db.$transaction(async (tx) => {

    // Acquire row-level lock to prevent double-charge from concurrent terminals.
    //
    // LOCK SCOPE NOTE (P3 hardening review 2026-04-10):
    // This FOR UPDATE lock is held for the entire transaction (bounded by the 10s timeout below).
    // We considered narrowing: Phase 1 (no lock) for validation, Phase 2 (locked) for insertion.
    // Decision: NOT safe to narrow. The validation phase (idempotency, amount checks, SAF dedup,
    // status guards) reads order.payments and order.status — these MUST be consistent with the
    // locked row to prevent TOCTOU double-charge. Splitting would require re-running all validation
    // after re-fetch, duplicating logic and introducing subtle race windows.
    //
    // Mitigations already in place:
    //   1. Permission checks run OUTSIDE the tx (lines ~94-138) — no lock held during auth
    //   2. PMS/OPERA HTTP calls run OUTSIDE the tx (lines ~140-285) — no lock during 1-5s HTTP
    //   3. 30s tx timeout caps worst-case lock duration
    //   4. Datacap card processing is fire-and-forget before the tx (pre-charge model)
    const [lockedRow] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE
    `
    if (!lockedRow) {
      return { earlyReturn: NextResponse.json({ error: 'Order not found' }, { status: 404 }) }
    }

    // PAYMENT-SAFETY: Synchronous replication for payment durability.
    // Guarantees the standby has applied this transaction's WAL before commit returns.
    // Prevents payment loss during HA failover (card charged but DB record lost).
    await enableSyncReplication(tx)

    // HA FAILOVER PROTECTION: Detect orphaned pending Datacap sales.
    // Uses a savepoint so a missing table doesn't abort the outer transaction.
    let orphanedSales: Array<{ id: string; amount: unknown; datacapRecordNo: string | null; invoiceNo: string | null }> = []
    try {
      await tx.$executeRaw`SAVEPOINT orphan_check`
      orphanedSales = await tx.$queryRaw<typeof orphanedSales>`
        SELECT id, amount, "datacapRecordNo", "invoiceNo" FROM "_pending_datacap_sales"
         WHERE "orderId" = ${orderId} AND "status" = 'pending' AND "createdAt" < NOW() - INTERVAL '60 seconds'
      `
      await tx.$executeRaw`RELEASE SAVEPOINT orphan_check`
    } catch {
      // Table may not exist on this NUC — roll back savepoint to keep transaction alive
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT orphan_check`.catch(err => log.warn({ err }, 'savepoint rollback failed'))
    }

    if (orphanedSales.length > 0) {
      console.warn(`[PAY] Found ${orphanedSales.length} orphaned pending Datacap sale(s) for order ${orderId}. These may need manual void.`)
      for (const sale of orphanedSales) {
        await tx.$executeRaw`
          UPDATE "_pending_datacap_sales" SET "status" = 'orphaned', "resolvedAt" = NOW() WHERE id = ${sale.id}
        `
      }
    }

    // Single query for order — replaces separate zero-check, idempotency, and main fetch queries
    // Includes items/employee/table so we can build receipt data in the response (avoids second fetch)
    // TX-KEEP: COMPLEX — complex include (location+customer+items+employee+table+payments) inside FOR UPDATE lock; locationId not yet available
    timing.start('db-fetch')
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        payments: true,
        location: { select: { id: true, settings: true, name: true, address: true, phone: true, timezone: true } },
        customer: true,
        items: { where: { deletedAt: null }, include: { modifiers: { where: { deletedAt: null } }, menuItem: { select: { id: true, itemType: true } } } },
        employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
        table: { select: { id: true, name: true } },
      },
    })

    timing.end('db-fetch', 'Fetch order')
    console.log(`[PAY-TRACE] order=${orderId} status=${order?.status} total=${order?.total} items=${order?.items?.length} payments=${order?.payments?.length}`)

    if (!order) {
      return { earlyReturn: NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      ) }
    }

    // P1: Pre-auth expiration warning (informational — does not block payment)
    if ((order as any).preAuthExpiresAt && new Date() > new Date((order as any).preAuthExpiresAt)) {
      console.warn(`[Pay] Pre-auth expired for order ${orderId}. Proceeding with payment.`)
    }

    // Guard: reject empty draft orders — they have $0 total but should NOT be closeable
    if (order.status === 'draft' && (!order.items || order.items.length === 0)) {
      return { earlyReturn: NextResponse.json(
        { error: 'Cannot close an empty draft order. Add items first.' },
        { status: 400 }
      ) }
    }

    if (order.total === null || order.total === undefined || isNaN(toNumber(order.total ?? 0))) {
      return { earlyReturn: NextResponse.json(
        { error: 'Order has invalid total. Please recalculate the order before payment.' },
        { status: 400 }
      ) }
    }

    // C11: Source-state validation — only allow payment on known payable statuses.
    // This prevents silent transitions from unexpected states (e.g., 'error', future states).
    if (!PAYABLE_STATUSES.includes(order.status) && !['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) {
      return { earlyReturn: NextResponse.json(
        { error: `Cannot pay order in '${order.status}' status` },
        { status: 400 }
      ) }
    }

    // Check for $0 order BEFORE Zod validation (Zod requires amount > 0,
    // but voided orders legitimately have $0 total and need to be closed)
    if (order.status !== 'paid' && order.status !== 'closed') {
      const zeroAlreadyPaid = roundToCents(order.payments
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + toNumber(p.amount), 0))
      const zeroRemaining = roundToCents(toNumber(order.total ?? 0) - zeroAlreadyPaid)
      if (zeroRemaining <= 0) {
        await ingestAndProject(tx as any, orderId, order.locationId, [
          { type: 'ORDER_CLOSED', payload: { closedStatus: 'paid' } }
        ])
        return { earlyReturn: NextResponse.json({ data: {
          success: true,
          orderId,
          orderStatus: 'paid',
          message: 'Order closed with $0 balance (all items voided/comped)',
          totals: { subtotal: 0, tax: 0, total: 0, tip: 0 },
        } }) }
      }
    }

    // Normalize legacy / Android offline-sync payment format → { payments: [...] }
    body = normalizePaymentInput(body)

    // Validate request body with Zod
    console.log('[PAY-DEBUG] normalized body:', JSON.stringify(body).substring(0, 500))
    const validation = PaymentRequestSchema.safeParse(body)
    if (!validation.success) {
      console.error('[PAY-400] Validation failed for', orderId, ':', JSON.stringify(validation.error.format()).substring(0, 500))
      return { earlyReturn: NextResponse.json(
        {
          error: 'Invalid payment request data',
          details: validation.error.format(),
        },
        { status: 400 }
      ) }
    }

    const { payments: rawPayments, employeeId, terminalId, idempotencyKey: bodyKey, capturedOrderTotal, skipDriftCheck } = validation.data
    // Widen Zod-inferred literal union to PaymentInput for domain layer compatibility
    const payments: PaymentInput[] = rawPayments as PaymentInput[]
    // Idempotency-Key header takes precedence over body field.
    // Android sends as "Idempotency-Key", normalize both header variants.
    const headerKey = request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key')
    const idempotencyKey = headerKey || bodyKey
    const finalIdempotencyKey = idempotencyKey || crypto.randomUUID()

    // P0: Unbounded tip guard
    const tipError = validateTipBounds(payments)
    if (tipError) {
      return { earlyReturn: NextResponse.json({ error: tipError }, { status: 400 }) }
    }

    // Idempotency check using already-loaded payments (no extra query needed)
    const idempDup = checkIdempotencyByKey(idempotencyKey, order.payments as any, order.status)
    if (idempDup) {
      return { earlyReturn: NextResponse.json({ data: {
        success: true,
        duplicate: true,
        ...idempDup.response,
        remainingBalance: 0,
      } }) }
    }

    // RecordNo-based idempotency check — check ALL payments, not just the first
    for (const payment of payments) {
      if (payment.datacapRecordNo) {
        const recordNoDup = checkIdempotencyByRecordNo(payment.datacapRecordNo, order.payments as any)
        if (recordNoDup) {
          return { earlyReturn: NextResponse.json(
            {
              error: 'Payment with this recordNo already exists for this order',
              code: 'DUPLICATE_RECORD_NO',
              existingPaymentId: recordNoDup.existingPaymentId,
            },
            { status: 409 }
          ) }
        }
      }
    }

    // R1: SECONDARY IDEMPOTENCY — amount+time dedup for network retries with new keys.
    // If a terminal retries a payment with a DIFFERENT idempotencyKey (client generated
    // a fresh UUID on retry), the key-based check above won't catch it. This query
    // detects a Payment for the same order with the same amount created in the last 30s.
    // MUST run BEFORE Datacap is called to prevent double-charging the card.
    const requestedBaseTotal = payments.reduce((sum, p) => sum + p.amount, 0)
    const recentDuplicate = await tx.payment.findFirst({
      where: {
        orderId,
        amount: { gte: requestedBaseTotal - 0.01, lte: requestedBaseTotal + 0.01 },
        createdAt: { gte: new Date(Date.now() - 30000) },
        status: { in: ['completed', 'pending'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true },
    })
    if (recentDuplicate) {
      log.warn({ orderId, existingPaymentId: recentDuplicate.id, amount: requestedBaseTotal }, 'R1: Blocked duplicate payment (amount+time dedup)')
      return { earlyReturn: NextResponse.json({ data: {
        success: true,
        duplicate: true,
        orderId,
        paymentId: recentDuplicate.id,
        amount: toNumber(recentDuplicate.amount),
        tipAmount: toNumber(recentDuplicate.tipAmount),
        totalAmount: toNumber(recentDuplicate.totalAmount),
        paymentMethod: recentDuplicate.paymentMethod,
        newOrderBalance: 0,
        remainingBalance: 0,
        message: 'Duplicate payment detected (same amount within 30s window)',
      } }) }
    }

    // SAF2: SAF DUPLICATE PREVENTION — if client retries payment while offline (SAF captures
    // with UUID-X on the reader), then network returns and client retries with UUID-Y, BOTH
    // charges succeed. Detect existing SAF payments for this order to prevent double-charge.
    // This check runs BEFORE Datacap is called so we never send a second authorization.
    const hasCardPayment = payments.some(p => p.method === 'credit' || p.method === 'debit')
    if (hasCardPayment) {
      const safDuplicate = await tx.payment.findFirst({
        where: {
          orderId,
          deletedAt: null,
          status: 'completed',
          OR: [
            { isOfflineCapture: true },
            { safStatus: { in: ['APPROVED_SAF_PENDING_UPLOAD', 'UPLOAD_PENDING', 'UPLOAD_SUCCESS'] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true, safStatus: true },
      })
      if (safDuplicate) {
        log.warn(
          { orderId, existingPaymentId: safDuplicate.id, safStatus: safDuplicate.safStatus, amount: toNumber(safDuplicate.amount) },
          'SAF2: Blocked duplicate payment — SAF payment already exists for this order'
        )
        return { earlyReturn: NextResponse.json({ data: {
          success: true,
          duplicate: true,
          orderId,
          paymentId: safDuplicate.id,
          amount: toNumber(safDuplicate.amount),
          tipAmount: toNumber(safDuplicate.tipAmount),
          totalAmount: toNumber(safDuplicate.totalAmount),
          paymentMethod: safDuplicate.paymentMethod,
          safStatus: safDuplicate.safStatus,
          newOrderBalance: 0,
          remainingBalance: 0,
          message: 'Duplicate payment detected — SAF (offline) payment already captured for this order',
        } }) }
      }
    }

    // C18: Permission checks moved OUTSIDE the FOR UPDATE transaction (above)
    // to reduce lock contention. No duplicate check needed here.

    // DOUBLE-CHARGE PREVENTION: Lock-and-check on _pending_captures table.
    // The FOR UPDATE lock above serializes concurrent requests for the SAME order,
    // but a client retry with the same idempotencyKey can slip through the in-memory
    // idempotency check (line above) if the first request hasn't committed yet.
    // This INSERT with a unique index on idempotencyKey acts as a durable lock:
    //   - First request: INSERT succeeds → proceed to payment
    //   - Concurrent retry: INSERT conflicts → return 409 (or cached result)
    // Uses a savepoint so a missing table (pre-migration NUCs) doesn't abort the transaction.
    let pendingCaptureInserted = false
    try {
      await tx.$executeRaw`SAVEPOINT pending_capture_check`
      const existingPending = await tx.$queryRaw<Array<{ id: string; status: string; response_json: string | null }>>`
        SELECT id, status, response_json FROM "_pending_captures" WHERE "idempotencyKey" = ${finalIdempotencyKey} LIMIT 1
      `
      if (Array.isArray(existingPending) && existingPending.length > 0) {
        const pending = existingPending[0] as any
        if (pending.status === 'processing') {
          await tx.$executeRaw`RELEASE SAVEPOINT pending_capture_check`
          return { earlyReturn: NextResponse.json(
            { error: 'Payment is already being processed. Please wait.', code: 'PAYMENT_IN_PROGRESS' },
            { status: 409 }
          )}
        }
        if (pending.status === 'completed' && pending.response_json) {
          await tx.$executeRaw`RELEASE SAVEPOINT pending_capture_check`
          // Return cached result — idempotent response
          return { earlyReturn: NextResponse.json(
            { error: 'Payment already processed', code: 'DUPLICATE_PAYMENT', existingPayment: JSON.parse(pending.response_json) },
            { status: 409 }
          )}
        }
        // status is 'failed' or 'pending' without response — allow retry by updating status
        await tx.$executeRaw`
          UPDATE "_pending_captures" SET "status" = 'processing', "errorMessage" = NULL WHERE "id" = ${pending.id}
        `
        pendingCaptureInserted = true
      } else {
        // No existing record — insert a new one with status='processing'
        const captureId = crypto.randomUUID()
        await tx.$executeRaw`
          INSERT INTO "_pending_captures" ("id", "orderId", "locationId", "cardRecordNo", "purchaseAmount", "totalAmount", "status", "idempotencyKey", "createdAt")
           VALUES (${captureId}, ${orderId}, ${order.locationId}, '', 0, 0, 'processing', ${finalIdempotencyKey}, NOW())
           ON CONFLICT ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL DO NOTHING
        `
        // Check if our insert won (ON CONFLICT DO NOTHING means 0 rows if conflict)
        const verifyInsert = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "_pending_captures" WHERE "idempotencyKey" = ${finalIdempotencyKey} AND "id" = ${captureId} LIMIT 1
        `
        if (Array.isArray(verifyInsert) && verifyInsert.length > 0) {
          pendingCaptureInserted = true
        } else {
          // Another concurrent request won the insert — this is a duplicate
          await tx.$executeRaw`RELEASE SAVEPOINT pending_capture_check`
          return { earlyReturn: NextResponse.json(
            { error: 'Payment is already being processed. Please wait.', code: 'PAYMENT_IN_PROGRESS' },
            { status: 409 }
          )}
        }
      }
      await tx.$executeRaw`RELEASE SAVEPOINT pending_capture_check`
    } catch (pcError) {
      // Table may not exist on pre-migration NUCs — roll back savepoint and proceed without protection
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT pending_capture_check`.catch(err => log.warn({ err }, 'savepoint rollback failed'))
      console.warn('[PAY] _pending_captures check failed (table may not exist), proceeding without lock', {
        orderId, error: pcError instanceof Error ? pcError.message : String(pcError),
      })
    }
    // Expose to outer catch block for failure cleanup
    if (pendingCaptureInserted) {
      pendingCaptureIdempotencyKey = finalIdempotencyKey
    }

    if (['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) {
      if (order.status === 'paid' || order.status === 'closed') {
        // TX-KEEP: COMPLEX — latest payment lookup inside FOR UPDATE lock; no repo method for latest-payment-by-order
        const existingPayment = await tx.payment.findFirst({
          where: { orderId, locationId: order.locationId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true },
        })
        return { earlyReturn: NextResponse.json({ data: {
          success: true,
          alreadyPaid: true,
          orderId,
          paymentId: existingPayment?.id ?? 'already-paid',
          amount: existingPayment ? toNumber(existingPayment.amount) : toNumber(order.total ?? 0),
          tipAmount: existingPayment ? toNumber(existingPayment.tipAmount) : 0,
          totalAmount: existingPayment ? toNumber(existingPayment.totalAmount) : toNumber(order.total ?? 0),
          paymentMethod: existingPayment?.paymentMethod ?? body.paymentMethod ?? 'cash',
          newOrderBalance: 0,
          orderStatus: order.status,
          message: `Order already ${order.status}`,
        } }) }
      }
      return { earlyReturn: NextResponse.json(
        { error: 'Cannot pay an order with status: ' + order.status },
        { status: 400 }
      ) }
    }

    // Parent = pay remaining — compute family remaining balance
    let splitPayRemainingOverride: number | null = null
    if (order.status === 'split') {
      const { computeSplitFamilyBalance } = await import('@/lib/domain/split-order/family-balance')
      const { closeSplitFamily } = await import('@/lib/domain/split-order/close-family')
      let family: any
      try {
        family = await computeSplitFamilyBalance(tx, order.id, order.locationId)
        console.log(`[PAY-SPLIT-PARENT] familyTotal=${family.familyTotal} remaining=${family.remainingBalance} paid=${family.paidTotal} isFullyPaid=${family.isFullyPaid}`)
      } catch (err) {
        console.error('[PAY-SPLIT-PARENT] computeSplitFamilyBalance FAILED:', err)
        // Fallback: use stored order total as the remaining balance
        family = { remainingBalance: toNumber(order.total ?? 0), familyTotal: toNumber(order.total ?? 0), isFullyPaid: false }
      }
      // Guard: if family balance seems inflated (legacy splits without splitFamilyTotal),
      // cap the remaining at the order's stored total — it was updated during split creation.
      const storedTotal = toNumber(order.total ?? 0)
      if (family.remainingBalance > storedTotal * 1.5) {
        console.warn(`[PAY-SPLIT-PARENT] Family remaining ${family.remainingBalance} exceeds stored total ${storedTotal} — capping to stored total`)
        family.remainingBalance = storedTotal
      }
      if (family.remainingBalance <= 0) {
        await closeSplitFamily(tx, order.id, order.locationId)
        return { earlyReturn: NextResponse.json({ data: {
          success: true,
          orderId,
          message: 'Split family already fully paid',
        } }) }
      }
      // Override effective total for this payment to the remaining balance
      splitPayRemainingOverride = family.remainingBalance
      log.info({ orderId, remaining: family.remainingBalance, familyTotal: family.familyTotal }, 'Split parent pay-remaining')
    }

    // Validate parent order is still in split state when paying a split child
    if (order.parentOrderId) {
      const parentOrder = await OrderRepository.getOrderByIdWithSelect(order.parentOrderId, order.locationId, { status: true, total: true }, tx)
      if (!parentOrder || parentOrder.status !== 'split') {
        return { earlyReturn: NextResponse.json(
          { error: 'Parent order is no longer in split state' },
          { status: 400 }
        ) }
      }

      // TX-KEEP: COMPLEX — cross-order payment aggregate across all split siblings inside FOR UPDATE lock; no repo method
      // FIX F5: Use base `amount` (excludes tips) instead of `totalAmount` (includes tips).
      // Comparing tip-inclusive totals against the tip-exclusive order.total would falsely
      // reject valid split payments or allow overpayment.
      const allSplitPayments = await tx.payment.aggregate({
        where: {
          order: { parentOrderId: order.parentOrderId },
          locationId: order.locationId,
          status: 'completed',
        },
        _sum: { amount: true },
      })
      const existingPaidTotal = toNumber(allSplitPayments._sum.amount ?? 0)
      const parentTotal = toNumber(parentOrder.total)
      const thisSplitPaymentTotal = payments.reduce((sum, p) => sum + p.amount, 0)
      // Tolerance must account for cash rounding accumulation across multiple splits.
      // With dollar rounding and 10 splits, each can round up by ~$0.50 → $5.00 total drift.
      // Use per-sibling rounding tolerance: $1.00 per split (covers dollar rounding worst case).
      const siblingCount = await tx.order.count({ where: { parentOrderId: order.parentOrderId, deletedAt: null } })
      const roundingTolerance = Math.max(0.01, siblingCount * 1.0)
      if (existingPaidTotal + thisSplitPaymentTotal > parentTotal + roundingTolerance) {
        return { earlyReturn: NextResponse.json(
          { error: `Total split payments ($${(existingPaidTotal + thisSplitPaymentTotal).toFixed(2)}) would exceed original order total ($${parentTotal.toFixed(2)})` },
          { status: 400 }
        ) }
      }
    }

    // Collect unsent items — will be auto-sent to kitchen after payment completes
    const unsentItems = order.items.filter(
      (i: any) => i.kitchenStatus === 'pending' && i.status === 'active'
    )

    // Get settings for rounding
    const settings = parseSettings(order.location.settings)

    // Compute current business day start for promotion on pay
    const locSettingsRaw = order.location.settings as Record<string, unknown> | null
    const dayStartTime = (locSettingsRaw?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct business day
    const payTz = (order.location as { timezone?: string }).timezone || 'America/New_York'
    const businessDayStart = getCurrentBusinessDay(dayStartTime, payTz).start

    // ── Financial context: entertainment settlement, validation, drift, auto-grat, drawer ──
    const finCtxResult = await buildPaymentFinancialContext({
      tx,
      order,
      payments,
      settings,
      capturedOrderTotal,
      skipDriftCheck,
      employeeId,
      terminalId,
      splitPayRemainingOverride,
    })
    if (!finCtxResult.ok) {
      return { earlyReturn: finCtxResult.response }
    }
    const {
      alreadyPaid,
      remaining,
      orderTotal,
      paymentBaseTotal,
      totalDriftWarning,
      autoGratApplied,
      autoGratNote,
      drawerAttribution,
      payments: resolvedPayments,
    } = finCtxResult.ctx
    // Use the (potentially auto-grat-mutated) payments from the context builder
    // Reassign to the mutable binding so the payment loop sees the updated tipAmounts
    payments.splice(0, payments.length, ...resolvedPayments)

    // Training mode: if order is a training order and suppressPayments is enabled,
    // create simulated payment records without hitting Datacap or deducting real balances.
    const isTrainingPayment = order.isTraining === true && settings.training?.suppressPayments !== false

    // ── Payment loop: build records, dispatch to method handlers, process HA items ──
    const loopResult = await processPaymentLoop({
      tx: tx as any,
      order: order as any,
      payments: payments as any,
      settings,
      remaining,
      alreadyPaid,
      orderTotal,
      drawerAttribution,
      preChargeResult: preChargeResult as any,
      employeeId,
      terminalId,
      orderId,
      finalIdempotencyKey,
      isTrainingPayment,
    })
    if (!loopResult.ok) {
      return { earlyReturn: loopResult.response }
    }
    const { allPendingPayments, totalTips, giftCardBalanceChanges, pmsAttemptId, pmsTransactionNo } = loopResult.result

    // ── Phase 5: Commit — status, loyalty, events, ingest, capture ──
    const isCellularPayment = request.headers.get('x-cellular-authenticated') === '1'
    const commitResult = await commitPaymentTransaction({
      tx,
      outerDb: db,
      order,
      loopResult: loopResult.result,
      payments,
      settings,
      alreadyPaid,
      paymentBaseTotal,
      orderTotal,
      businessDayStart,
      employeeId: employeeId ?? null,
      terminalId: terminalId ?? null,
      orderId,
      pendingCaptureInserted,
      finalIdempotencyKey,
      splitPayRemainingOverride,
      isCellular: isCellularPayment,
      autoGratApplied,
      autoGratNote,
      isTrainingPayment,
      totalDriftWarning,
      unsentItems,
      timing,
    })

    if ('earlyReturn' in commitResult) {
      return commitResult
    }

    // Hoist auto-void info and loyalty multiplier from commit result
    autoVoidRecords = commitResult.autoVoidRecords
    autoVoidTerminalId = commitResult.autoVoidTerminalId
    autoVoidLocationId = commitResult.autoVoidLocationId
    loyaltyTierMultiplier = commitResult.loyaltyTierMultiplier

    return commitResult

    }, { timeout: 10000 })

    if ('earlyReturn' in txResult) {
      return (txResult as any).earlyReturn as NextResponse
    }

    const {
      order,
      ingestResult,
      settings,
      payments,
      employeeId,
      terminalId,
      allPendingPayments,
      totalTips,
      newTipTotal,
      newPaidTotal,
      effectiveTotal,
      paidTolerance,
      orderIsPaid,
      updateData,
      pointsEarned,
      newAverageTicket,
      loyaltyEarningBase,
      shouldUpdateCustomerStats,
      pmsAttemptId,
      pmsTransactionNo,
      unsentItems,
      businessDayStart,
      paymentMutationOrigin,
      hasCash,
      autoGratApplied,
      autoGratNote,
      isTrainingPayment,
      giftCardBalanceChanges,
      isSplitPayRemaining,
      totalDriftWarning,
    } = txResult as any

    // ── Post-commit effects (fire-and-forget, independently try/caught) ──
    runPaymentPostCommitEffects({
      orderId,
      order,
      ingestResult,
      settings,
      payments,
      employeeId,
      terminalId,
      allPendingPayments,
      totalTips,
      newTipTotal,
      newPaidTotal,
      effectiveTotal,
      paidTolerance,
      orderIsPaid,
      updateData,
      pointsEarned,
      newAverageTicket,
      loyaltyEarningBase,
      shouldUpdateCustomerStats,
      pmsAttemptId,
      pmsTransactionNo,
      unsentItems,
      businessDayStart,
      paymentMutationOrigin,
      hasCash,
      autoGratApplied,
      autoGratNote,
      isTrainingPayment,
      giftCardBalanceChanges,
      isSplitPayRemaining,
      totalDriftWarning,
      loyaltyTierMultiplier,
    })

    // Build receipt data via domain module (eliminates separate /receipt fetch)
    const receiptData = buildReceiptData(order as any, ingestResult.bridgedPayments, pointsEarned, settings as any)

    // Return response — includes flat fields for Android's PayOrderData DTO
    const primaryPayment = ingestResult.bridgedPayments[0]
    const finalStatus = orderIsPaid ? 'paid' : 'partial'
    const finalBalance = orderIsPaid ? 0 : Math.max(0, effectiveTotal - newPaidTotal)
    return ok({
      success: true,
      // Flat fields for Android compatibility
      orderId,
      paymentId: primaryPayment?.id ?? null,
      amount: primaryPayment ? primaryPayment.amount : 0,
      tipAmount: primaryPayment ? primaryPayment.tipAmount : 0,
      totalAmount: primaryPayment ? primaryPayment.totalAmount : 0,
      paymentMethod: primaryPayment?.paymentMethod ?? 'cash',
      newOrderBalance: finalBalance,
      orderStatus: finalStatus,
      // Full payment list for web POS
      payments: ingestResult.bridgedPayments.map((p: any) => ({
        id: p.id,
        paymentMethod: p.paymentMethod,
        method: p.paymentMethod,
        amount: p.amount,
        tipAmount: p.tipAmount,
        totalAmount: p.totalAmount,
        amountTendered: p.amountTendered ? toNumber(p.amountTendered) : null,
        changeGiven: p.changeGiven ? toNumber(p.changeGiven) : null,
        roundingAdjustment: p.roundingAdjustment ? toNumber(p.roundingAdjustment) : null,
        cardBrand: p.cardBrand,
        cardLast4: p.cardLast4,
        authCode: p.authCode,
        status: p.status,
      })),
      remainingBalance: finalBalance,
      receiptData,
      // Loyalty info
      loyaltyPointsEarned: pointsEarned,
      customerId: order.customer?.id || null,
      // Auto-gratuity info (when applied)
      ...(autoGratApplied ? { autoGratuityApplied: true, autoGratuityNote: autoGratNote } : {}),
      // R3: Total drift warning — included when order total changed between client capture and payment
      ...(totalDriftWarning ? {
        totalDriftWarning: {
          capturedTotal: totalDriftWarning.capturedTotal,
          currentTotal: totalDriftWarning.currentTotal,
          drift: totalDriftWarning.drift,
          message: `Order total changed by $${totalDriftWarning.drift.toFixed(2)} since payment was initiated`,
        },
      } : {}),
      // Card-on-file: signal to front-end that card can be saved (fire-and-forget check)
      ...(() => {
        try {
          if (!settings.cardOnFile?.enabled || !settings.cardOnFile.allowSaveCard) return {}
          if (!order.customer?.id) return {}
          const cardPayment = ingestResult.bridgedPayments.find(
            (p: any) => (p.paymentMethod === 'credit' || p.paymentMethod === 'debit') && p.cardLast4 && p.datacapRecordNo
          )
          if (!cardPayment) return {}
          return {
            canSaveCard: true,
            saveCardInfo: {
              last4: cardPayment.cardLast4,
              cardBrand: cardPayment.cardBrand || 'UNKNOWN',
              token: cardPayment.datacapRecordNo,
            },
          }
        } catch { return {} }
      })(),
    })
  } catch (error) {
    return handlePaymentFailure({
      error,
      orderId,
      body,
      db,
      pendingCaptureIdempotencyKey,
      autoVoidRecords,
      autoVoidTerminalId,
      autoVoidLocationId,
    })
  }
}, 'orders-pay'))
