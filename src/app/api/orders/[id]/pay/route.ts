// build-bust: v2.0.25
import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as PaymentRepository from '@/lib/repositories/payment-repository'
import * as OrderItemRepository from '@/lib/repositories/order-item-repository'
import { OrderStatus, PaymentMethod, PaymentStatus, PmsAttemptStatus } from '@/generated/prisma/client'
import { parseSettings } from '@/lib/settings'
import { requireAnyPermission, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { errorCapture } from '@/lib/error-capture'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { roundToCents, toNumber } from '@/lib/pricing'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchOrderTotalsUpdate, dispatchPaymentProcessed, dispatchCFDReceiptSent, dispatchOrderClosed, dispatchNewOrder, dispatchTableStatusChanged, dispatchEntertainmentStatusChanged, dispatchGiftCardBalanceChanged } from '@/lib/socket-dispatch'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { resolveDeliveryTipRecipient } from '@/lib/delivery/tip-reallocation'
import { withVenue } from '@/lib/with-venue'
import { emitCloudEvent } from '@/lib/cloud-events'
import { triggerCashDrawer } from '@/lib/cash-drawer'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { CAKE_SETTLEMENT_TYPES } from '@/lib/cake-orders/schemas'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { ingestAndProject, type IngestEvent } from '@/lib/order-events/ingester'
import { OrderRouter } from '@/lib/order-router'
import { batchUpdateOrderItemStatus } from '@/lib/batch-updates'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { printKitchenTicketsForManifests } from '@/lib/print-template-factory'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { enableSyncReplication } from '@/lib/db-helpers'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { checkOrderClaim } from '@/lib/order-claim'
import { PAYABLE_STATUSES } from '@/lib/domain/order-status'
import { getRequestLocationId } from '@/lib/request-context'
import {
  PaymentRequestSchema,
  normalizePaymentInput,
  resolveDrawerForPayment,
  buildPaymentFinancialContext,
  checkIdempotencyByKey,
  checkIdempotencyByRecordNo,
  validateTipBounds,
  processPaymentLoop,
  buildReceiptData,
  type PaymentInput,
  type PaymentRecord,
} from '@/lib/domain/payment'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-pay')

// POST - Process payment for order
export const POST = withVenue(withTiming(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params
  const timing = getTimingFromRequest(request)
  let body: Record<string, unknown> = {}
  let autoVoidRecords: Record<string, unknown>[] = []
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

    // Hoisted for post-transaction access (populated inside tx)
    let loyaltyTierMultiplier: number = 1.0

    const txResult = await db.$transaction(async (tx) => {

    // Acquire row-level lock to prevent double-charge from concurrent terminals.
    //
    // LOCK SCOPE NOTE (P3 hardening review 2026-04-10):
    // This FOR UPDATE lock is held for the entire transaction (bounded by the 30s timeout below).
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

    const { payments, employeeId, terminalId, idempotencyKey: bodyKey, capturedOrderTotal, skipDriftCheck } = validation.data
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

    const orderTotal = splitPayRemainingOverride != null
      ? splitPayRemainingOverride
      : toNumber(order.total ?? 0)

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

    // Update order status and tip total
    const newTipTotal = roundToCents(toNumber(order.tipTotal ?? 0) + totalTips)
    // Use paymentBaseTotal (excludes tips) for balance comparison — tips should NOT
    // count toward paying the order balance, only base payment amounts do.
    const newPaidTotal = alreadyPaid + paymentBaseTotal

    // When price rounding is active for cash, the paid amount may be less than orderTotal
    // by up to the rounding increment (e.g., $3.25 paid for $3.29 order with quarter rounding).
    // The tolerance must cover this gap so the order is marked fully paid.
    const hasCash = payments.some(p => p.method === 'cash')
    const paidTolerance = (hasCash && settings.priceRounding?.enabled && settings.priceRounding.applyToCash)
      ? roundToCents(parseFloat(settings.priceRounding.increment) / 2)  // Half the increment covers rounding in either direction
      : 0.01

    const updateData: {
      tipTotal: number
      primaryPaymentMethod?: PaymentMethod
      status?: OrderStatus
      paidAt?: Date
      closedAt?: Date
      businessDayDate: Date
    } = {
      tipTotal: newTipTotal,
      businessDayDate: businessDayStart,
    }

    // Set primary payment method based on the payment with the largest amount.
    // In split-tender scenarios, the largest payment determines the primary method
    // (e.g., $80 card + $20 cash → primary is 'card'). If tied, first wins.
    if (!order.primaryPaymentMethod) {
      const largestPayment = payments.reduce((max, p) =>
        (p.amount || 0) > (max.amount || 0) ? p : max
      , payments[0])
      const primaryMethod = largestPayment.method
      updateData.primaryPaymentMethod = (primaryMethod === 'cash' ? 'cash' : 'card') as PaymentMethod
    }

    // Mark as paid if fully paid
    // Dual pricing: orderTotal IS the cash price (stored price model).
    // Card price = orderTotal * (1 + cashDiscountPercent/100).
    // For cash payments effectiveTotal is simply orderTotal — do NOT call
    // calculateCashPrice() on it, which would incorrectly reduce it a second time.
    // Cash rounding (applied earlier to validationRemaining) is handled separately;
    // the paid-detection threshold here uses the raw cash total.
    const effectiveTotal = orderTotal
    if (newPaidTotal >= effectiveTotal - paidTolerance) {
      updateData.status = 'paid'
      updateData.paidAt = new Date()
      updateData.closedAt = new Date()
    } else if (newPaidTotal > 0) {
      // H8: Partial payment received — lock order from silent abandonment.
      // Orders in 'in_progress' status remain in the open orders list and are
      // visible on all terminals. Recovery paths:
      //   1. Additional payment(s) to reach full balance
      //   2. Manager void of the partial payment (returns order to 'open')
      //   3. Shift-close reconciliation — manager must resolve open partials
      // There is no automatic timeout or expiry — manual resolution is required.
      if (order.status === 'open' || order.status === 'draft') {
        updateData.status = 'in_progress'
      }
      if (!order.paidAt) {
        updateData.paidAt = new Date()
      }
    }

    // Pre-compute loyalty points BEFORE the transaction (avoid nested findUnique inside tx)
    let pointsEarned = 0
    let loyaltyEarningBase = 0
    if (updateData.status === 'paid' && order.customer && settings.loyalty.enabled) {
      loyaltyEarningBase = settings.loyalty.earnOnSubtotal
        ? toNumber(order.subtotal ?? 0)
        : toNumber(order.total ?? 0)
      if (settings.loyalty.earnOnTips) {
        loyaltyEarningBase += newTipTotal
      }
      // Check for tier multiplier from LoyaltyTier (Loyalty System migration 098)
      const custTierId = (order.customer as any).loyaltyTierId
      if (custTierId) {
        try {
          const tierRows = await db.$queryRaw<Array<{ pointsMultiplier: unknown }>>`
            SELECT "pointsMultiplier" FROM "LoyaltyTier" WHERE "id" = ${custTierId} AND "deletedAt" IS NULL
          `
          if (tierRows.length > 0) {
            loyaltyTierMultiplier = Number(tierRows[0].pointsMultiplier) || 1.0
          }
        } catch { /* table may not exist yet — graceful fallback */ }
      }
      if (loyaltyEarningBase >= settings.loyalty.minimumEarnAmount) {
        pointsEarned = Math.round(loyaltyEarningBase * settings.loyalty.pointsPerDollar * loyaltyTierMultiplier)
      }
    }

    // Pre-compute averageTicket using already-fetched customer data (no extra query needed)
    // Customer stats (totalSpent, totalOrders, lastVisit, averageTicket) update whenever
    // a linked customer's order is fully paid — regardless of loyalty being enabled.
    let newAverageTicket: number | null = null
    const shouldUpdateCustomerStats = updateData.status === 'paid' && order.status !== 'paid' && !!order.customer
    if (shouldUpdateCustomerStats) {
      const currentTotalSpent = toNumber((order.customer as any).totalSpent ?? 0)
      const currentTotalOrders = (order.customer as any).totalOrders ?? 0
      const newTotal = roundToCents(currentTotalSpent + toNumber(order.total ?? 0))
      const newOrders = currentTotalOrders + 1
      newAverageTicket = roundToCents(newTotal / newOrders)
    }

    // ── Build payment events ──────────────────────────────────────────
    const paymentEvents: IngestEvent[] = []
    const bridgeOverrides: Record<string, Record<string, unknown>> = {}

    // HA cellular sync — detect mutation origin for Payment stamping
    const isCellularPayment = request.headers.get('x-cellular-authenticated') === '1'
    const paymentMutationOrigin = isCellularPayment ? 'cloud' : 'local'

    for (const record of allPendingPayments) {
      const rec = record as any
      const paymentId = rec.id || crypto.randomUUID()

      // Ensure the record has an ID for bridge override keying
      rec.id = paymentId

      paymentEvents.push({
        type: 'PAYMENT_APPLIED',
        payload: {
          paymentId,
          method: rec.paymentMethod,
          amountCents: Math.round(toNumber(rec.amount) * 100),
          tipCents: Math.round(toNumber(rec.tipAmount ?? 0) * 100),
          totalCents: Math.round(toNumber(rec.totalAmount) * 100),
          cardBrand: rec.cardBrand ?? null,
          cardLast4: rec.cardLast4 ?? null,
          status: 'approved',
        },
      })

      // All the extra Payment fields that aren't in the domain event
      bridgeOverrides[paymentId] = { ...rec, lastMutatedBy: paymentMutationOrigin }
      // Remove fields already in the event payload to avoid conflicts
      delete bridgeOverrides[paymentId].amount
      delete bridgeOverrides[paymentId].tipAmount
      delete bridgeOverrides[paymentId].totalAmount
      delete bridgeOverrides[paymentId].paymentMethod
      delete bridgeOverrides[paymentId].cardBrand
      delete bridgeOverrides[paymentId].cardLast4
      delete bridgeOverrides[paymentId].status
      delete bridgeOverrides[paymentId].orderId
      delete bridgeOverrides[paymentId].locationId
    }

    // Add ORDER_CLOSED if fully paid
    const orderIsPaid = newPaidTotal >= effectiveTotal - paidTolerance
    if (orderIsPaid) {
      paymentEvents.push({
        type: 'ORDER_CLOSED',
        payload: { closedStatus: 'paid' },
      })
    }

    // ── Ingest synchronously ──────────────────────────────────────────
    autoVoidRecords = allPendingPayments.filter(
      (r: any) => (r.paymentMethod === 'credit' || r.paymentMethod === 'debit') && r.datacapRecordNo
    )
    autoVoidTerminalId = terminalId
    autoVoidLocationId = order.locationId

    timing.start('db-pay')
    const ingestResult = await ingestAndProject(tx as any, orderId, order.locationId, paymentEvents, {
      paymentBridgeOverrides: bridgeOverrides,
      employeeId: employeeId || undefined,
    })
    timing.end('db-pay', 'Payment ingestion')

    // DOUBLE-CHARGE PREVENTION: Mark pending capture as 'completed' now that payment is recorded.
    // This runs inside the same transaction, so if the tx rolls back the capture stays 'processing'
    // (which is correct — it will be retryable). Fire-and-forget with savepoint for safety.
    if (pendingCaptureInserted) {
      try {
        await tx.$executeRaw`SAVEPOINT pc_complete`
        const responseJson = JSON.stringify({
          orderId,
          paymentIds: allPendingPayments.map((r: any) => r.id).filter(Boolean),
          amount: allPendingPayments.reduce((sum: number, r: any) => sum + toNumber(r.amount ?? 0), 0),
        })
        await tx.$executeRaw`
          UPDATE "_pending_captures" SET "status" = 'completed', "completedAt" = NOW(), "response_json" = ${responseJson}
           WHERE "idempotencyKey" = ${finalIdempotencyKey} AND "status" = 'processing'
        `
        await tx.$executeRaw`RELEASE SAVEPOINT pc_complete`
      } catch {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT pc_complete`.catch(err => log.warn({ err }, 'savepoint rollback failed'))
      }
    }

    if (ingestResult.alreadyPaid) {
      // TX-KEEP: COMPLEX — latest payment lookup after ingest race inside FOR UPDATE lock; no repo method
      const existingPayment = await tx.payment.findFirst({
        where: { orderId, locationId: order.locationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true },
      })
      const freshOrder = await OrderRepository.getOrderByIdWithSelect(orderId, order.locationId, { total: true, status: true }, tx)
      return { earlyReturn: NextResponse.json({ data: {
        success: true,
        alreadyPaid: true,
        orderId,
        paymentId: existingPayment?.id ?? 'already-paid',
        amount: existingPayment ? toNumber(existingPayment.amount) : toNumber(freshOrder?.total ?? 0),
        tipAmount: existingPayment ? toNumber(existingPayment.tipAmount) : 0,
        totalAmount: existingPayment ? toNumber(existingPayment.totalAmount) : toNumber(freshOrder?.total ?? 0),
        paymentMethod: existingPayment?.paymentMethod ?? 'cash',
        newOrderBalance: 0,
        orderStatus: freshOrder?.status ?? 'paid',
      } }) }
    }

    return {
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
      isSplitPayRemaining: splitPayRemainingOverride != null,
      totalDriftWarning,
    }

    }, { timeout: 30000 })

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

    // R3: POST-TRANSACTION DRIFT SOCKET NOTIFICATION
    // The primary drift detection now happens INSIDE the transaction (before payment insertion).
    // This post-transaction block only emits the socket event for drift warnings that were
    // allowed through (minor drift or acknowledged via skipDriftCheck).
    if (totalDriftWarning) {
      void dispatchPaymentProcessed(order.locationId, {
        orderId,
        status: 'total_drift_warning',
        totalDriftDetected: true,
        capturedTotal: totalDriftWarning.capturedTotal,
        currentTotal: totalDriftWarning.currentTotal,
        drift: totalDriftWarning.drift,
        sourceTerminalId: terminalId || undefined,
      } as any).catch(e => log.warn({ err: e }, 'R3: total drift socket dispatch failed'))
    }

    if (isInOutageMode()) {
      // Flag payments processed during outage for reconciliation visibility
      const paymentIds = ingestResult.bridgedPayments.map((bp: { id: string }) => bp.id)
      if (paymentIds.length > 0) {
        // Batch flag payments for reconciliation (tenant-safe via PaymentRepository)
        for (const pid of paymentIds) {
          void PaymentRepository.updatePayment(pid, order.locationId, { needsReconciliation: true })
            .catch(err => console.error('[CRITICAL-PAYMENT] Failed to flag payment for reconciliation:', err))
        }
      }

      // Read back full Payment rows from local PG — BridgedPayment is missing
      // NOT NULL columns (locationId, createdAt, updatedAt, processedAt) that
      // would cause constraint violations on Neon replay.
      // CRITICAL: Outage queue writes are the ONLY path to Neon during outage.
      // If these fail, payment data is lost from cloud. Retry once.
      const fullPayments = await Promise.all(
        (paymentIds as string[]).map(pid => PaymentRepository.getPaymentById(pid, order.locationId))
      ).then(results => results.filter((p): p is NonNullable<typeof p> => p !== null))
      for (const fp of fullPayments) {
        void queueOutageWrite('Payment', fp.id, 'INSERT', fp as unknown as Record<string, unknown>, order.locationId).catch(async (err) => {
          console.error(`[CRITICAL-PAYMENT] Outage queue write failed for Payment ${fp.id}, retrying:`, err)
          try { await queueOutageWrite('Payment', fp.id, 'INSERT', fp as unknown as Record<string, unknown>, order.locationId) } catch (retryErr) {
            console.error(`[CRITICAL-PAYMENT] Outage queue write retry FAILED for Payment ${fp.id}:`, retryErr)
          }
        })
      }
      // Read back full Order for complete payload (updateData is partial)
      const fullOrder = await OrderRepository.getOrderById(orderId, order.locationId)
      if (fullOrder) {
        void queueOutageWrite('Order', orderId, 'UPDATE', fullOrder as unknown as Record<string, unknown>, order.locationId).catch(async (err) => {
          console.error(`[CRITICAL-PAYMENT] Outage queue write failed for Order ${orderId}, retrying:`, err)
          try { await queueOutageWrite('Order', orderId, 'UPDATE', fullOrder as unknown as Record<string, unknown>, order.locationId) } catch (retryErr) {
            console.error(`[CRITICAL-PAYMENT] Outage queue write retry FAILED for Order ${orderId}:`, retryErr)
          }
        })
      }
    }

    if (unsentItems.length > 0) {
      const autoSendIds = unsentItems
        .filter((i: any) => i.menuItem?.itemType !== 'timed_rental')
        .map((i: any) => i.id)
      if (autoSendIds.length > 0) {
        void (async () => {
          try {
            const now = new Date()
            await batchUpdateOrderItemStatus(autoSendIds, 'sent', now)
            const routingResult = await OrderRouter.resolveRouting(orderId, autoSendIds)
            void dispatchNewOrder(order.locationId, routingResult, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
            void printKitchenTicketsForManifests(routingResult, order.locationId).catch(err => log.warn({ err }, 'Background task failed'))
            void deductPrepStockForOrder(orderId, autoSendIds).catch(err => log.warn({ err }, 'Background task failed'))
            void emitOrderEvent(order.locationId, orderId, 'ORDER_SENT', { sentItemIds: autoSendIds })
          } catch (caughtErr) {
            console.error('[pay] Auto-send to kitchen failed:', err)
          }
        })()
      }
    }

    if (pmsAttemptId && pmsTransactionNo) {
      void db.pmsChargeAttempt.update({
        where: { id: pmsAttemptId },
        data: { status: 'COMPLETED', operaTransactionId: pmsTransactionNo },
      }).catch(err => console.error('[pay/room_charge] Failed to mark attempt COMPLETED:', err))
    }

    let parentWasMarkedPaid = false
    let parentTableId: string | null = null
    // Close split family when: (a) child payment completes family, or (b) parent pay-remaining
    const isSplitFamilyMember = order.parentOrderId || isSplitPayRemaining
    if (orderIsPaid && isSplitFamilyMember) {
      try {
        const { computeSplitFamilyBalance } = await import('@/lib/domain/split-order/family-balance')
        const { closeSplitFamily } = await import('@/lib/domain/split-order/close-family')
        // For child: root is parentOrderId. For parent pay-remaining: root is this order.
        const rootId = (order as any).splitFamilyRootId || order.parentOrderId || orderId
        const family = await computeSplitFamilyBalance(db, rootId, order.locationId)
        if (family.isFullyPaid) {
          await closeSplitFamily(db, rootId, order.locationId)
          parentWasMarkedPaid = true
          parentTableId = order.tableId ?? null
        }
      } catch (caughtErr) {
        console.error('[Pay] Split family closure check failed:', caughtErr)
      }
    }

    // Post-ingestion: customer stats + loyalty points earning (fire-and-forget)
    // Customer stats (totalSpent, totalOrders, lastVisit, averageTicket) update whenever
    // a linked customer's order is fully paid. Loyalty points only increment if earned.
    if (orderIsPaid && shouldUpdateCustomerStats && order.customer) {
      void db.customer.update({
        where: { id: order.customer.id },
        data: {
          ...(pointsEarned > 0 ? { loyaltyPoints: { increment: pointsEarned }, lifetimePoints: { increment: pointsEarned } } : {}),
          totalSpent: { increment: toNumber(order.total ?? 0) },
          totalOrders: { increment: 1 },
          lastVisit: new Date(),
          averageTicket: newAverageTicket!,
          lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
        },
      }).catch(err => console.error('Post-ingestion customer/loyalty update failed:', err))

      // Create LoyaltyTransaction record + check tier promotion (fire-and-forget)
      if (pointsEarned > 0) {
        void (async () => {
          try {
            const custId = order.customer!.id
            const currentPoints = Number((order.customer as any).loyaltyPoints ?? 0)
            const currentLifetime = Number((order.customer as any).lifetimePoints ?? 0)
            const txnId = crypto.randomUUID()
            const balAfter = currentPoints + pointsEarned
            const loyaltyDesc = `Earned ${pointsEarned} points on order #${order.orderNumber}${loyaltyTierMultiplier > 1 ? ` (${loyaltyTierMultiplier}x tier)` : ''}`
            const loyaltyEmpId = employeeId || null
            await db.$executeRaw`
              INSERT INTO "LoyaltyTransaction" (
                "id", "customerId", "locationId", "orderId", "type", "points",
                "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
              ) VALUES (${txnId}, ${custId}, ${order.locationId}, ${orderId}, 'earn', ${pointsEarned},
              ${currentPoints}, ${balAfter},
              ${loyaltyDesc},
              ${loyaltyEmpId}, NOW())
            `
            // Check tier promotion
            const newLifetime = currentLifetime + pointsEarned
            const custProgramId = (order.customer as any).loyaltyProgramId
            if (custProgramId) {
              const tiers = await db.$queryRaw<Array<{ id: string; name: string; minimumPoints: number }>>`
                SELECT "id", "name", "minimumPoints" FROM "LoyaltyTier"
                 WHERE "programId" = ${custProgramId} AND "deletedAt" IS NULL ORDER BY "minimumPoints" DESC
              `
              const currentTierId = (order.customer as any).loyaltyTierId
              for (const tier of tiers) {
                if (newLifetime >= Number(tier.minimumPoints)) {
                  if (tier.id !== currentTierId) {
                    await db.$executeRaw`
                      UPDATE "Customer" SET "loyaltyTierId" = ${tier.id}, "updatedAt" = NOW() WHERE "id" = ${custId}
                    `
                  }
                  break
                }
              }
            }
          } catch (caughtErr) {
            console.error('Post-ingestion loyalty transaction/tier check failed:', err)
          }
        })()
      }
    }

    // Post-ingestion: audit logs (fire-and-forget)
    for (const bp of ingestResult.bridgedPayments) {
      void db.auditLog.create({
        data: {
          locationId: order.locationId,
          employeeId: employeeId || null,
          action: 'payment_processed',
          entityType: 'payment',
          entityId: bp.id,
          details: {
            paymentMethod: bp.paymentMethod,
            amount: bp.amount,
            tipAmount: bp.tipAmount,
            orderId,
            orderNumber: order.orderNumber,
          },
        },
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    if (orderIsPaid) {
      void db.auditLog.create({
        data: {
          locationId: order.locationId,
          employeeId: employeeId || null,
          action: 'order_closed',
          entityType: 'order',
          entityId: orderId,
          details: {
            orderNumber: order.orderNumber,
            totalPaid: newPaidTotal,
            paymentCount: ingestResult.bridgedPayments.length,
            paymentMethods: [...new Set(ingestResult.bridgedPayments.map((p: any) => p.paymentMethod))],
          } as any,
        },
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Post-ingestion: update fields not in event state
    // CRITICAL: These writes update businessDayDate, tipTotal, primaryPaymentMethod.
    // If they fail, the order record is stale for reports and EOD. Retry once before giving up.
    const postPaymentOrderUpdate = orderIsPaid
      ? {
          businessDayDate: businessDayStart,
          primaryPaymentMethod: updateData.primaryPaymentMethod,
          tipTotal: newTipTotal,
          version: { increment: 1 } as const,
          lastMutatedBy: paymentMutationOrigin,
        }
      : {
          tipTotal: newTipTotal,
          ...(updateData.primaryPaymentMethod ? { primaryPaymentMethod: updateData.primaryPaymentMethod } : {}),
          lastMutatedBy: paymentMutationOrigin,
        }

    try {
      await OrderRepository.updateOrder(orderId, order.locationId, postPaymentOrderUpdate)
    } catch (caughtErr) {
      console.error('[CRITICAL-PAYMENT] Post-payment order update failed, retrying:', err)
      try {
        // Retry without version increment — if the first write committed but timed out,
        // we don't want to double-increment. The critical fields (businessDayDate, tipTotal,
        // primaryPaymentMethod) are idempotent, so a duplicate write is safe.
        const { version: _v, ...retryData } = postPaymentOrderUpdate as any
        await OrderRepository.updateOrder(orderId, order.locationId, { ...retryData, lastMutatedBy: paymentMutationOrigin })
      } catch (retryErr) {
        console.error('[CRITICAL-PAYMENT] Post-payment order update retry FAILED — order will have stale report fields:', retryErr)
        // Log to error capture so it appears in monitoring dashboard
        void errorCapture.critical('PAYMENT', 'Post-payment order update failed after retry', {
          category: 'payment-post-update-error',
          action: 'Updating order fields after payment',
          orderId,
          error: retryErr instanceof Error ? retryErr : undefined,
        }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
      }
    }

    // Dispatch socket events when parent order was auto-closed (after transaction commit)
    if (parentWasMarkedPaid) {
      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'paid',
        orderId: order.parentOrderId!,
        tableId: parentTableId || undefined,
        sourceTerminalId: terminalId || undefined,
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
      void dispatchFloorPlanUpdate(order.locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
      invalidateSnapshotCache(order.locationId)

      // Emit explicit parent closure event so ALL devices close the parent immediately
      void dispatchPaymentProcessed(order.locationId, {
        orderId: order.parentOrderId!,
        status: 'closed',
        isClosed: true,
        parentAutoClose: true,
        sourceTerminalId: terminalId || undefined,
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
      // TODO: Add TableRepository once that repository exists
      if (parentTableId) {
        void db.table.update({
          where: { id: parentTableId },
          data: { status: 'available' },
        }).then(() => {
          invalidateSnapshotCache(order.locationId)
          // M5: Emit table:status-changed for parent table too
          void dispatchTableStatusChanged(order.locationId, { tableId: parentTableId!, status: 'available' }).catch(err => log.warn({ err }, 'Background task failed'))
        }).catch(err => {
          console.error('[Pay] Parent table status reset failed:', err)
        })
      }
    }

    // If order is fully paid, reset entertainment items and table status
    if (orderIsPaid) {
      // Reset entertainment items after payment
      // TODO: migrate to MenuItemRepository/FloorPlanElementRepository once those repos exist
      // (queries use currentOrderId filter + relation-filter menuItem.itemType, not supported by current repos)
      try {
        const entertainmentItems = await db.menuItem.findMany({
          where: { locationId: order.locationId, currentOrderId: orderId, itemType: 'timed_rental' },
          select: { id: true },
        })

        if (entertainmentItems.length > 0) {
          // Clear blockTimeStartedAt on order items so Android stops showing timers
          // TODO: relation-filter (menuItem.itemType) not supported by OrderItemRepository.updateItemsWhere
          await db.orderItem.updateMany({
            where: { orderId, locationId: order.locationId, menuItem: { itemType: 'timed_rental' }, blockTimeStartedAt: { not: null } },
            data: { blockTimeStartedAt: null },
          })

          await db.menuItem.updateMany({
            where: { locationId: order.locationId, currentOrderId: orderId, itemType: 'timed_rental' },
            data: {
              entertainmentStatus: 'available',
              currentOrderId: null,
              currentOrderItemId: null,
            },
          })

          // Reset FloorPlanElements
          for (const item of entertainmentItems) {
            await db.floorPlanElement.updateMany({
              where: { locationId: order.locationId, linkedMenuItemId: item.id, deletedAt: null, status: 'in_use' },
              data: {
                status: 'available',
                currentOrderId: null,
                sessionStartedAt: null,
                sessionExpiresAt: null,
              },
            })
          }

          // Dispatch socket events + notify waitlist
          void dispatchFloorPlanUpdate(order.locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
          for (const item of entertainmentItems) {
            void dispatchEntertainmentStatusChanged(order.locationId, {
              itemId: item.id,
              entertainmentStatus: 'available',
              currentOrderId: null,
              expiresAt: null,
            }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
            void notifyNextWaitlistEntry(order.locationId, item.id).catch(err => log.warn({ err }, 'waitlist notify failed'))
          }
        }
      } catch (entertainmentErr) {
        console.error('[Pay] Failed to reset entertainment items:', entertainmentErr)
      }

      // ── Inventory Deduction Outbox ──────────────────────────────────────────
      // Create PendingDeduction synchronously after payment commit.
      // If this fails, log but don't block payment response.
      try {
        const firstPaymentId = ingestResult.bridgedPayments[0]?.id ?? null
        // P1: Guard against re-deduction — don't reset succeeded/dead deductions back to pending
        const existingDeduction = await db.pendingDeduction.findUnique({ where: { orderId } })
        if (!existingDeduction) {
          await db.pendingDeduction.create({
            data: {
              locationId: order.locationId,
              orderId,
              paymentId: firstPaymentId,
              deductionType: 'order_deduction',
              status: 'pending',
            },
          })
        } else if (existingDeduction.status !== 'succeeded' && existingDeduction.status !== 'dead') {
          await db.pendingDeduction.update({
            where: { orderId },
            data: {
              paymentId: firstPaymentId,
              status: 'pending',
              availableAt: new Date(),
              lastError: null,
            },
          })
        }
        // If already succeeded or dead, skip — no re-deduction
      } catch (caughtErr) {
        console.error('[Pay] Failed to create PendingDeduction outbox row:', err)
      }

      // Best-effort async processing (non-blocking)
      void (async () => {
        try {
          const { processNextDeduction } = await import('@/lib/deduction-processor')
          await processNextDeduction()
        } catch (caughtErr) {
          console.error('[Pay] Best-effort deduction trigger failed (outbox will retry):', err)
        }
      })()

      // Recalculate commission from active items only (voided items zeroed)
      void (async () => {
        try {
          // TODO: Add getActiveItemsForOrderWithMenuItemCommission to OrderItemRepository
          const activeItems = await db.orderItem.findMany({
            where: { orderId, locationId: order.locationId, status: 'active', deletedAt: null },
            include: {
              menuItem: { select: { commissionType: true, commissionValue: true } },
            },
          })

          let recalculatedCommission = 0
          const commissionUpdates: { id: string; commission: number }[] = []

          for (const item of activeItems) {
            const mi = item.menuItem
            if (!mi?.commissionType || !mi?.commissionValue) continue

            const itemTotal = toNumber(item.itemTotal ?? 0)
            const qty = item.quantity
            const val = toNumber(mi.commissionValue)
            const commission = mi.commissionType === 'percent'
              ? roundToCents(itemTotal * val / 100)
              : roundToCents(val * qty)

            if (commission !== toNumber(item.commissionAmount ?? 0)) {
              commissionUpdates.push({ id: item.id, commission })
            }
            recalculatedCommission += commission
          }

          // Batch update all changed commissions in a single SQL statement
          // eslint-disable-next-line -- $executeRawUnsafe required: dynamic CASE clause count with numbered params
          if (commissionUpdates.length > 0) {
            const caseClauses = commissionUpdates.map((_, i) => `WHEN id = $${i * 2 + 1} THEN $${i * 2 + 2}`).join(' ')
            const ids = commissionUpdates.map(u => u.id)
            const params: (string | number)[] = []
            for (const u of commissionUpdates) {
              params.push(u.id, u.commission)
            }
            params.push(...ids)
            const mutOriginIdx = commissionUpdates.length * 2 + ids.length + 1
            const idPlaceholders = ids.map((_, i) => `$${commissionUpdates.length * 2 + i + 1}`).join(', ')
            params.push(paymentMutationOrigin)
            await db.$executeRawUnsafe(
              `UPDATE "OrderItem" SET "commissionAmount" = CASE ${caseClauses} END, "updatedAt" = NOW(), "lastMutatedBy" = $${mutOriginIdx} WHERE id IN (${idPlaceholders})`,
              ...params
            )
          }

          const currentTotal = toNumber(order.commissionTotal ?? 0)
          if (Math.abs(recalculatedCommission - currentTotal) > 0.001) {
            await OrderRepository.updateOrder(orderId, order.locationId, {
              commissionTotal: recalculatedCommission, lastMutatedBy: paymentMutationOrigin,
            })
          }
        } catch (caughtErr) {
          console.error('[Pay] Commission recalculation failed:', err)
        }
      })()

      // Kick cash drawer on cash payments (Skill 56) — fire-and-forget
      // Failure must never fail the payment response
      // Pass terminalId so the drawer kicks on THIS terminal's printer, not the location default
      if (hasCash) {
        void triggerCashDrawer(order.locationId, terminalId || undefined).catch(err => log.warn({ err }, 'cash drawer trigger failed'))
        const localDrawer = await resolveDrawerForPayment('cash', employeeId || null, terminalId)
        if (localDrawer.drawerId && employeeId) {
          void (async () => {
            try {
              const ownerShift = await db.shift.findFirst({
                where: {
                  drawerId: localDrawer.drawerId!,
                  status: 'open',
                  deletedAt: null,
                },
                select: { id: true, employeeId: true },
              })
              if (ownerShift && ownerShift.employeeId !== employeeId) {
                void db.auditLog.create({
                  data: {
                    locationId: order.locationId,
                    employeeId,
                    action: 'manager_drawer_access',
                    entityType: 'drawer',
                    entityId: localDrawer.drawerId!,
                    details: {
                      shiftOwnerEmployeeId: ownerShift.employeeId,
                      shiftId: ownerShift.id,
                      orderId,
                      reason: 'Payment processed by different employee',
                    },
                  },
                }).catch(err => log.warn({ err }, 'Background task failed'))
              }
            } catch (caughtErr) {
              console.error('[Pay] Manager drawer access audit failed:', err)
            }
          })()
        }
      }

      // Allocate tips via the tip bank pipeline (Skill 269)
      // Handles: CC fee deduction, tip group detection, ownership splits, ledger posting
      // TIP DURABILITY: Awaited with try/catch + durable recovery record on failure.
      // Tips captured on the card MUST reach the tip ledger — fire-and-forget is not acceptable.
      // Skill 277: kind defaults to 'tip' (voluntary gratuity). Future callers
      // (e.g. bottle service auto-gratuity) should pass 'auto_gratuity' or 'service_charge'.
      // Resolve tip owner: order's assigned employee, or the processing employee as fallback.
      // Without fallback, tips on unassigned orders (e.g. walk-up kiosk) would be silently dropped.
      //
      // Delivery orders: tip goes to the assigned driver (or holding ledger if no driver yet).
      // resolveDeliveryTipRecipient checks DeliveryOrder and returns the correct recipientId.
      let tipOwnerEmployeeId = order.employeeId || employeeId
      if (totalTips > 0 && order.orderType === 'delivery' && !isTrainingPayment) {
        try {
          // Look up the delivery order linked to this POS order
          const deliveryOrders = await db.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "DeliveryOrder"
             WHERE "orderId" = ${orderId} AND "locationId" = ${order.locationId} AND "deletedAt" IS NULL
             LIMIT 1
          `
          if (deliveryOrders.length) {
            const resolved = await resolveDeliveryTipRecipient(
              order.locationId,
              deliveryOrders[0].id,
            )
            tipOwnerEmployeeId = resolved.recipientId
          }
        } catch (caughtErr) {
          // Delivery tip resolution failure falls back to standard tip owner
          console.error('[Pay] Delivery tip recipient resolution failed, using default:', err)
        }

        if (tipOwnerEmployeeId) {
          // Allocate tips per-payment to ensure each payment gets its own
          // TipTransaction. This prevents a void of one split payment from
          // charging back tips that belong to a different payment.
          for (const bp of ingestResult.bridgedPayments) {
            const paymentTip = Number(bp.tipAmount) || 0
            if (paymentTip <= 0) continue

            const tipAllocParams = {
              locationId: order.locationId,
              orderId,
              primaryEmployeeId: tipOwnerEmployeeId,
              createdPayments: [{
                id: bp.id,
                paymentMethod: bp.paymentMethod,
                tipAmount: bp.tipAmount,
              }],
              totalTipsDollars: paymentTip,
              tipBankSettings: settings.tipBank,
              kind: autoGratApplied ? 'auto_gratuity' : 'tip',
            }
            try {
              await allocateTipsForPayment(tipAllocParams)
            } catch (tipErr) {
              console.error('[PAYMENT-SAFETY] Delivery tip allocation failed — creating recovery record', {
                orderId, paymentId: bp.id, tipAmount: paymentTip,
                error: tipErr instanceof Error ? tipErr.message : String(tipErr),
              })
              try {
                await db.auditLog.create({
                  data: {
                    locationId: order.locationId,
                    action: 'tip_allocation_failed',
                    entityType: 'order',
                    entityId: orderId,
                    details: {
                      flow: 'pay-delivery',
                      tipAmount: paymentTip,
                      primaryEmployeeId: tipOwnerEmployeeId,
                      paymentId: bp.id,
                      paymentMethod: bp.paymentMethod,
                      kind: autoGratApplied ? 'auto_gratuity' : 'tip',
                      error: tipErr instanceof Error ? tipErr.message : String(tipErr),
                      retryParams: tipAllocParams,
                    },
                  },
                })
              } catch (auditErr) {
                console.error('[PAYMENT-SAFETY] CRITICAL: Both tip allocation AND recovery record failed (pay-delivery)', {
                  orderId, locationId: order.locationId, tipAmount: paymentTip,
                  employeeId: tipOwnerEmployeeId, paymentId: bp.id,
                  tipError: tipErr instanceof Error ? tipErr.message : String(tipErr),
                  auditError: auditErr instanceof Error ? auditErr.message : String(auditErr),
                })
              }
            }
          }
        }
      } else if (totalTips > 0 && !isTrainingPayment && (order as any).orderTypeRef?.allowTips !== false) {
        if (tipOwnerEmployeeId) {
          // Allocate tips per-payment to ensure each payment gets its own
          // TipTransaction with a per-payment idempotency key. This prevents
          // a void of one split payment from charging back tips belonging to
          // a different payment.
          for (const bp of ingestResult.bridgedPayments) {
            const paymentTip = Number(bp.tipAmount) || 0
            if (paymentTip <= 0) continue

            const tipAllocParams = {
              locationId: order.locationId,
              orderId,
              primaryEmployeeId: tipOwnerEmployeeId,
              createdPayments: [{
                id: bp.id,
                paymentMethod: bp.paymentMethod,
                tipAmount: bp.tipAmount,
              }],
              totalTipsDollars: paymentTip,
              tipBankSettings: settings.tipBank,
              kind: autoGratApplied ? 'auto_gratuity' : 'tip',
            }
            try {
              await allocateTipsForPayment(tipAllocParams)
            } catch (tipErr) {
              console.error('[PAYMENT-SAFETY] Tip allocation failed (pay) — creating recovery record', {
                orderId, paymentId: bp.id, tipAmount: paymentTip,
                error: tipErr instanceof Error ? tipErr.message : String(tipErr),
              })
              try {
                await db.auditLog.create({
                  data: {
                    locationId: order.locationId,
                    action: 'tip_allocation_failed',
                    entityType: 'order',
                    entityId: orderId,
                    details: {
                      flow: 'pay',
                      tipAmount: paymentTip,
                      primaryEmployeeId: tipOwnerEmployeeId,
                      paymentId: bp.id,
                      paymentMethod: bp.paymentMethod,
                      kind: autoGratApplied ? 'auto_gratuity' : 'tip',
                      error: tipErr instanceof Error ? tipErr.message : String(tipErr),
                      retryParams: tipAllocParams,
                    },
                  },
                })
              } catch (auditErr) {
                console.error('[PAYMENT-SAFETY] CRITICAL: Both tip allocation AND recovery record failed (pay)', {
                  orderId, locationId: order.locationId, tipAmount: paymentTip,
                  employeeId: tipOwnerEmployeeId, paymentId: bp.id,
                  tipError: tipErr instanceof Error ? tipErr.message : String(tipErr),
                  auditError: auditErr instanceof Error ? auditErr.message : String(auditErr),
                })
              }
            }
          }
        } else {
          // No employee to allocate tips to — the tip is still recorded in
          // Payment.tipAmount so the money is tracked, but no TipTransaction
          // is created. Log a warning so management can manually assign later
          // via the tip management UI.
          console.warn(`[pay] Tip of $${totalTips.toFixed(2)} on order ${orderId} has no employee to allocate to`)
          void db.auditLog.create({
            data: {
              locationId: order.locationId,
              action: 'unallocated_tip',
              entityType: 'order',
              entityId: orderId,
              details: {
                totalTips,
                paymentIds: ingestResult.bridgedPayments.map((bp: { id: string }) => bp.id),
                reason: 'No employeeId on order or payment request',
              },
            },
          }).catch(err => {
            console.error('[pay] Failed to create audit log for unallocated tip:', err)
          })
        }
      }

      // Release table only if no OTHER open orders remain on it (fire-and-forget)
      if (order.tableId) {
        void (async () => {
          try {
            // TODO: Add countOpenOrdersForTableExcluding to OrderRepository
            const otherOpenOrders = await db.order.count({
              where: {
                tableId: order.tableId!,
                locationId: order.locationId,
                id: { not: order.id },
                status: { in: ['open', 'sent', 'in_progress', 'draft', 'split'] },
                deletedAt: null,
              },
            })
            if (otherOpenOrders === 0) {
              // TODO: Add TableRepository once that repository exists
              await db.table.update({
                where: { id: order.tableId! },
                data: { status: 'available' },
              })
              invalidateSnapshotCache(order.locationId)
              void dispatchTableStatusChanged(order.locationId, { tableId: order.tableId!, status: 'available' }).catch(err => log.warn({ err }, 'Background task failed'))
            }
          } catch (caughtErr) {
            console.error('[Pay] Table status reset failed:', err)
          }
        })()
      }

      // Clean up temporary seats then dispatch floor plan update
      // Chain: cleanup must finish BEFORE dispatch so snapshot doesn't still see temp seats
      void cleanupTemporarySeats(orderId)
        .then(() => {
          if (order.tableId && orderIsPaid) {
            return dispatchFloorPlanUpdate(order.locationId, { async: true })
          }
        })
        .catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Dispatch real-time order totals update (tip changed) — fire-and-forget
    if (totalTips > 0) {
      void dispatchOrderTotalsUpdate(order.locationId, orderId, {
        subtotal: toNumber(order.subtotal ?? 0),
        taxTotal: toNumber(order.taxTotal ?? 0),
        tipTotal: newTipTotal,
        discountTotal: toNumber(order.discountTotal ?? 0),
        total: toNumber(order.total ?? 0),
      }, { async: true }).catch(err => {
        console.error('Failed to dispatch order totals update:', err)
      })
    }

    // Dispatch payment:processed for each created payment (fire-and-forget)
    // Enriched payload lets Android clients construct PAYMENT_APPLIED locally without HTTP round-trip
    for (const p of ingestResult.bridgedPayments) {
      void dispatchPaymentProcessed(order.locationId, {
        orderId,
        paymentId: p.id,
        status: 'completed',
        sourceTerminalId: terminalId || undefined,
        method: p.paymentMethod,
        amount: p.amount,
        tipAmount: p.tipAmount || 0,
        totalAmount: p.totalAmount,
        employeeId: employeeId || null,
        isClosed: orderIsPaid,
        cardBrand: p.cardBrand || null,
        cardLast4: p.cardLast4 || null,
        // Split context: let clients know this is a split child and whether all siblings are done
        parentOrderId: order.parentOrderId || null,
        allSiblingsPaid: parentWasMarkedPaid,
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
    }

    // Dispatch gift card balance changes for fraud prevention (fire-and-forget)
    for (const gc of giftCardBalanceChanges) {
      void dispatchGiftCardBalanceChanged(order.locationId, gc).catch(err => log.warn({ err }, 'gift card balance dispatch failed'))
    }

    // Release order claim after successful payment (fire-and-forget)
    if (orderIsPaid) {
      void db.$executeRaw`
        UPDATE "Order" SET "claimedByEmployeeId" = NULL, "claimedByTerminalId" = NULL, "claimedAt" = NULL WHERE id = ${orderId}
      `.catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
    }

    // Dispatch open orders list changed when order is fully paid (fire-and-forget)
    // Include sourceTerminalId so receiving clients can suppress "closed on another terminal" banners
    if (orderIsPaid) {
      void dispatchOpenOrdersChanged(order.locationId, { trigger: 'paid', orderId: order.id, tableId: order.tableId || undefined, sourceTerminalId: terminalId || undefined }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))
      void dispatchOrderClosed(order.locationId, {
        orderId: order.id,
        status: 'paid',
        closedAt: new Date().toISOString(),
        closedByEmployeeId: employeeId || null,
        locationId: order.locationId,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
    }

    // Notification Platform: auto-release pager assignments when order is paid
    if (orderIsPaid) {
      void (async () => {
        try {
          const { releaseAssignmentsForSubject } = await import('@/lib/notifications/release-assignments')
          await releaseAssignmentsForSubject(order.locationId, 'order', order.id, 'order_paid', employeeId || undefined)
        } catch (releaseErr) {
          console.warn('[Pay] Failed to release notification assignments:', releaseErr)
        }
      })()
    }

    // Notify CFD that receipt was sent — transitions CFD to thank-you screen (fire-and-forget)
    if (orderIsPaid) {
      dispatchCFDReceiptSent(order.locationId, null, {
        orderId: order.id,
        total: toNumber(order.total ?? 0),
      })
    }

    // Emit cloud event for fully paid orders (fire-and-forget)
    if (orderIsPaid) {
      void emitCloudEvent('order_paid', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        venueId: order.locationId,
        employeeId: order.employeeId,
        customerId: order.customerId,
        orderType: order.orderType,
        paidAt: new Date(),
        subtotal: toNumber(order.subtotal ?? 0),
        taxTotal: toNumber(order.taxTotal ?? 0),
        tipTotal: newTipTotal,
        discountTotal: toNumber(order.discountTotal ?? 0),
        total: toNumber(order.total ?? 0),
        payments: ingestResult.bridgedPayments.map((p: any) => ({
          id: p.id,
          method: p.paymentMethod,
          amount: p.amount,
          tipAmount: p.tipAmount,
          totalAmount: p.totalAmount,
          cardLast4: p.cardLast4 ?? null,
        })),
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Auto-send email receipt for online orders (fire-and-forget)
    // Online orders (pickup, delivery, online) with a customer email get an automatic receipt
    if (orderIsPaid && order.orderType && ['online', 'pickup', 'delivery'].includes(order.orderType)) {
      const customerEmail = (order.customer as any)?.email
      if (customerEmail) {
        void fetch(`${process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`}/api/receipts/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            email: customerEmail,
            locationId: order.locationId,
          }),
        }).catch(err => console.error('[Pay] Auto email receipt for online order failed:', err))
      }
    }

    // Cake settlement post-payment hook (fire-and-forget)
    if (orderIsPaid && order.orderType && CAKE_SETTLEMENT_TYPES.includes(order.orderType as any)) {
      void (async () => {
        try {
          const { handleCakeSettlementCompletion } = await import('@/lib/cake-orders/cake-payment-service')
          await handleCakeSettlementCompletion(db, {
            orderId: order.id,
            paymentId: ingestResult.bridgedPayments[0]?.id || '',
            locationId: order.locationId,
            employeeId: order.employeeId || '',
          })
        } catch (caughtErr) {
          console.error('[Pay] Cake settlement completion hook failed:', err)
        }
      })()
    }

    // Trigger upstream sync (fire-and-forget, debounced)
    pushUpstream()

    // Build receipt data via domain module (eliminates separate /receipt fetch)
    const receiptData = buildReceiptData(order as any, ingestResult.bridgedPayments, pointsEarned, settings as any)

    // Card recognition: fire-and-forget BEFORE response return.
    // Sends a separate socket event instead of blocking the HTTP response (-10-50ms).
    if (!order.customer?.id && settings.tabs?.cardRecognitionEnabled) {
      void (async () => {
        try {
          const cardPayment = ingestResult.bridgedPayments.find(
            (p: any) => (p.paymentMethod === 'credit' || p.paymentMethod === 'debit') && p.cardLast4
          )
          if (!cardPayment) return
          const matchedProfile = await db.cardProfile.findFirst({
            where: {
              locationId: order.locationId,
              cardLast4: cardPayment.cardLast4,
              customerId: { not: null },
              deletedAt: null,
            },
            include: {
              customer: {
                select: { id: true, firstName: true, lastName: true, displayName: true, phone: true },
              },
            },
            orderBy: { lastSeenAt: 'desc' },
          })
          if (!matchedProfile?.customer) return
          // Emit card recognition via socket so POS can show the suggestion asynchronously
          const { emitToLocation } = await import('@/lib/socket-server')
          await emitToLocation(order.locationId, 'payment:card-recognized', {
            orderId,
            recognizedCustomer: {
              customerId: matchedProfile.customer.id,
              name: matchedProfile.customer.displayName || `${matchedProfile.customer.firstName} ${matchedProfile.customer.lastName}`,
              phone: matchedProfile.customer.phone,
              visitCount: matchedProfile.visitCount,
              cardType: matchedProfile.cardType,
              cardLast4: matchedProfile.cardLast4,
            },
          })
        } catch (caughtErr) {
          log.warn({ err }, 'Card recognition fire-and-forget failed')
        }
      })()
    }

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
    console.error('Failed to process payment:', error)

    // DOUBLE-CHARGE PREVENTION: Mark pending capture as 'failed' so the idempotency key
    // can be retried. Fire-and-forget — if this fails the record stays 'processing' which
    // will block retries for safety (ops can manually reset via DB).
    if (pendingCaptureIdempotencyKey) {
      const pcErrorMsg = (error instanceof Error ? error.message : String(error)).substring(0, 500)
      void db.$executeRaw`
        UPDATE "_pending_captures" SET "status" = 'failed', "errorMessage" = ${pcErrorMsg}
         WHERE "idempotencyKey" = ${pendingCaptureIdempotencyKey} AND "status" = 'processing'
      `.catch((pcErr) => {
        console.warn('[PAY] Failed to mark pending capture as failed', {
          idempotencyKey: pendingCaptureIdempotencyKey,
          error: pcErr instanceof Error ? pcErr.message : String(pcErr),
        })
      })
    }

    if (autoVoidRecords.length > 0 && autoVoidTerminalId && autoVoidLocationId) {
      const locationId = autoVoidLocationId
      const tid = autoVoidTerminalId
      const records = autoVoidRecords
      void (async () => {
        try {
          const terminal = await db.terminal.findUnique({
            where: { id: tid },
            select: { paymentReaderId: true },
          })
          if (!terminal?.paymentReaderId) {
            console.error('[CRITICAL-PAYMENT] Cannot auto-void: no reader bound to terminal', {
              terminalId: tid, orderId, records: records.map((r: any) => r.datacapRecordNo),
            })
            return
          }
          const client = await getDatacapClient(locationId)
          for (const record of records) {
            const recordNo = (record as any).datacapRecordNo
            try {
              const voidResult = await client.voidSale(terminal.paymentReaderId!, { recordNo })
              const voided = voidResult.cmdStatus === 'Approved'
              console.error(`[CRITICAL-PAYMENT] Auto-void ${voided ? 'SUCCEEDED' : 'FAILED'} for recordNo=${recordNo}`, {
                orderId,
                amount: (record as any).amount,
                voidResult: { cmdStatus: voidResult.cmdStatus, textResponse: voidResult.textResponse },
              })
            } catch (voidErr) {
              console.error(`[CRITICAL-PAYMENT] Auto-void EXCEPTION for recordNo=${recordNo}`, {
                orderId, amount: (record as any).amount, error: voidErr,
              })
            }
          }
        } catch (lookupErr) {
          console.error('[CRITICAL-PAYMENT] Auto-void lookup failed', {
            orderId, terminalId: tid, error: lookupErr,
          })
        }
      })()

      return NextResponse.json(
        {
          error: 'Payment approved but recording failed — automatic reversal attempted. Check Datacap portal to confirm.',
          datacapRecordNos: records.map((r: any) => r.datacapRecordNo),
        },
        { status: 500 }
      )
    }

    console.error(`[PAY-500] Order ${orderId} payment failed:`, error instanceof Error ? error.stack : String(error))
    void errorCapture.critical('PAYMENT', 'Payment processing failed', {
      category: 'payment-processing-error',
      action: `Processing payment for Order ${orderId}`,
      orderId,
      error: error instanceof Error ? error : undefined,
      path: `/api/orders/${orderId}/pay`,
      requestBody: body,
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
    void import('@/lib/venue-logger').then(({ logVenueEvent }) =>
      logVenueEvent({
        level: 'error',
        source: 'server',
        category: 'payment',
        message: `Payment failed for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
        details: { orderId, method: body?.method },
        stackTrace: error instanceof Error ? error.stack : undefined,
      })
    ).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json(
      { error: 'Failed to process payment', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}, 'orders-pay'))
