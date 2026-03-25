import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { requireDatacapClient, validateReader, normalizeCardholderName } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { TabUpdatedPayload, OrdersListChangedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushSocketOutbox } from '@/lib/socket-outbox'
import { recordTab, DuplicateTabError } from '@/lib/datacap/record-tab'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { OrderRepository } from '@/lib/repositories'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { resolveDetection } from '@/lib/domain/payment-readers/listener-service'

// POST - Card-first tab open flow
// 1. CollectCardData (reads chip for cardholder name)
// 2. EMVPreAuth for configurable hold amount
// 3. Creates OrderCard record
// 4. Updates order with tab name from chip
//
// PAYMENT-SAFETY: Idempotency
// No explicit idempotency key is needed. Card-present duplicate detection uses two stages:
//   Stage 1 (after CollectCardData): Check if the vault's recordNo already has an open tab.
//   Stage 2 (after EMVPreAuth): Check if the preAuth's recordNo already has an open tab.
// If a duplicate is found, the new hold is voided and the existing tab is returned.
// This is sufficient for card-present flows because the recordNo is unique per card vault entry.
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { readerId, employeeId, detectionId, expectedOrderVersion } = body

    if (!readerId || !employeeId) {
      return NextResponse.json({ error: 'Missing required fields: readerId, employeeId' }, { status: 400 })
    }

    // Get the order -- use repository for tenant-safe access, then fetch location settings
    // TODO: Add OrderRepository.getOrderByIdWithInclude variant that supports nested location include
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { location: { select: { id: true, settings: true } } },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const locationId = order.locationId

    // Auth check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // ── Optimistic concurrency check ──────────────────────────────────
    // If expectedOrderVersion is provided, verify the order hasn't been modified
    // since the client last read it. Prevents stale-state mutations.
    if (expectedOrderVersion !== undefined) {
      const currentVersion = (order as any).version ?? 1
      if (currentVersion !== expectedOrderVersion) {
        return NextResponse.json(
          { error: 'Order has been modified by another terminal', code: 'order_version_conflict' },
          { status: 409 }
        )
      }
    }

    // ── Passive card detection path ───────────────────────────────────
    // If detectionId is present, resolve server-side CardDetection → card data,
    // then skip CollectCardData + EMVPreAuth and go straight to recordTab().
    if (detectionId) {
      const resolved = await resolveDetection(detectionId, 'open_tab', {
        locationId,
        terminalId: body.terminalId,
        employeeId: auth.employee.id,
        targetOrderId: orderId,
      })

      if ('error' in resolved) {
        const statusMap: Record<string, number> = {
          detection_expired: 409,
          unauthorized: 403,
          detection_not_found: 404,
          already_resolved: 409,
          invalid_card_payload: 400,
        }
        return NextResponse.json(
          { error: resolved.error, code: resolved.code },
          { status: statusMap[resolved.code] || 400 }
        )
      }

      // Use resolved card data from the detection (recordNo stays server-side)
      const { recordNo, cardType, cardLast4, cardholderName: resolvedName } = resolved

      if (!recordNo) {
        return NextResponse.json(
          { error: 'Detection has no recordNo — card data is invalid', code: 'invalid_card_payload' },
          { status: 400 }
        )
      }

      const finalCardholderName = normalizeCardholderName(resolvedName || undefined)
      const orderTotal = Number(order.total) || 0
      const preAuthAmount = Math.max(orderTotal, 1)
      const settings = parseSettings(order.location.settings)

      // Set pending_auth
      await OrderRepository.updateOrder(orderId, locationId, { tabStatus: 'pending_auth', version: { increment: 1 } })

      // PreAuth using the detection's recordNo (card-not-present, by record)
      let resolvedReaderId = readerId
      try {
        await validateReader(readerId, locationId)
      } catch {
        const fallbackReader = await db.paymentReader.findFirst({
          where: { locationId, deletedAt: null, isActive: true },
          select: { id: true },
        })
        if (!fallbackReader) {
          return NextResponse.json({ error: 'No active payment reader found for this location' }, { status: 400 })
        }
        resolvedReaderId = fallbackReader.id
      }

      const client = await requireDatacapClient(locationId)
      const preAuthResponse = await client.preAuth(resolvedReaderId, {
        invoiceNo: orderId,
        amount: preAuthAmount,
        requestRecordNo: true,
        recordNo, // Use the resolved recordNo from detection
      })

      const preAuthError = parseError(preAuthResponse)
      const approved = preAuthResponse.cmdStatus === 'Approved'

      if (!approved) {
        const declineFirstName = finalCardholderName
        await db.$transaction(async (tx) => {
          await OrderRepository.updateOrder(orderId, locationId, {
            tabStatus: 'auth_failed',
            tabName: declineFirstName || order.tabName,
            version: { increment: 1 },
          }, tx)
          const tabPayload: TabUpdatedPayload = { orderId, status: 'auth_failed' }
          await queueSocketEvent(tx, locationId, SOCKET_EVENTS.TAB_UPDATED, tabPayload)
          const listPayload: OrdersListChangedPayload = { trigger: 'updated', orderId, tableId: order.tableId || undefined }
          await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)
        })
        void flushSocketOutbox(locationId).catch((err) => {
          console.warn('[open-tab] Outbox flush failed:', err)
        })
        void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
          tabStatus: 'auth_failed',
          tabName: declineFirstName || order.tabName || null,
        }).catch(err => console.error('[order-events] open-tab detection decline:', err))

        return NextResponse.json({
          data: {
            approved: false,
            tabStatus: 'auth_failed',
            cardholderName: declineFirstName,
            cardType: cardType || preAuthResponse.cardType,
            cardLast4: cardLast4 || preAuthResponse.cardLast4,
            error: preAuthError
              ? { code: preAuthError.code, message: preAuthError.text, isRetryable: preAuthError.isRetryable }
              : { code: 'DECLINED', message: 'Pre-authorization declined', isRetryable: true },
          },
        })
      }

      const finalRecordNo = preAuthResponse.recordNo || recordNo
      try {
        const result = await recordTab({
          locationId,
          orderId,
          readerId: resolvedReaderId,
          recordNo: finalRecordNo,
          cardType: cardType || preAuthResponse.cardType || 'unknown',
          cardLast4: cardLast4 || preAuthResponse.cardLast4 || '????',
          cardholderName: finalCardholderName,
          authAmount: preAuthAmount,
          authCode: preAuthResponse.authCode,
          tabName: order.tabName || undefined,
          tableId: order.tableId,
          tokenFrequency: 'Recurring',
          acqRefData: preAuthResponse.acqRefData,
          processData: preAuthResponse.processData,
          aid: preAuthResponse.aid,
          cvm: preAuthResponse.cvm ? String(preAuthResponse.cvm) : undefined,
          refNo: preAuthResponse.refNo,
        })

        pushUpstream()

        return NextResponse.json({
          data: {
            approved: true,
            tabStatus: 'open',
            cardholderName: finalCardholderName,
            cardType: cardType || preAuthResponse.cardType || 'unknown',
            cardLast4: cardLast4 || preAuthResponse.cardLast4 || '????',
            authAmount: preAuthAmount,
            recordNo: finalRecordNo,
            orderCardId: result.orderCardId,
          },
        })
      } catch (err) {
        if (err instanceof DuplicateTabError) {
          void client.voidSale(resolvedReaderId, { recordNo: finalRecordNo }).catch(voidErr =>
            console.error('[Tab Open] Failed to void duplicate hold (detection path):', voidErr)
          )
          void OrderRepository.updateOrder(orderId, locationId, { tabStatus: 'open' }).catch(() => {})
          return NextResponse.json({
            data: {
              tabStatus: 'existing_tab_found',
              existingTab: err.existingTab,
            },
          })
        }
        throw err
      }
    }

    // ── Standard card-present flow (no detectionId) ───────────────────
    const settings = parseSettings(order.location.settings)

    // Pre-auth amount = current order total (first drink), minimum $1
    // This ensures the hold matches what the customer is actually ordering
    const orderTotal = Number(order.total) || 0
    const preAuthAmount = Math.max(orderTotal, 1)

    // Try the given readerId first, fall back to any active reader for this location
    let resolvedReaderId = readerId
    try {
      await validateReader(readerId, locationId)
    } catch {
      // TODO: Add PaymentReaderRepository.getActiveReader() once that repository exists
      const fallbackReader = await db.paymentReader.findFirst({
        where: { locationId, deletedAt: null, isActive: true },
        select: { id: true },
      })
      if (!fallbackReader) {
        return NextResponse.json({ error: 'No active payment reader found for this location' }, { status: 400 })
      }
      resolvedReaderId = fallbackReader.id
    }
    const client = await requireDatacapClient(locationId)

    // EDGE-7: Auto-recover stale pending_auth (stuck > 5 minutes)
    if (order.tabStatus === 'pending_auth') {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
      if (order.updatedAt < fiveMinAgo) {
        await OrderRepository.updateOrder(orderId, locationId, { tabStatus: 'open', version: { increment: 1 } })
        console.warn('[EDGE-7] Auto-recovered stale pending_auth', { orderId, staleAt: order.updatedAt.toISOString() })
        // Event sourcing: record the auto-recovery as metadata update
        void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
          tabStatus: 'open',
          reason: 'stale_pending_auth_recovery',
        }).catch(err => console.error('[order-events] EDGE-7 recovery emit failed:', err))
      } else {
        // Still within 5-minute window — another terminal may be processing
        return NextResponse.json({
          error: 'Tab authorization is already in progress on another terminal',
          tabStatus: 'pending_auth',
        }, { status: 409 })
      }
    }

    // Step 1: Set tab status to pending_auth immediately
    await OrderRepository.updateOrder(orderId, locationId, { tabStatus: 'pending_auth', version: { increment: 1 } })

    // Step 2: CollectCardData to read chip (cardholder name)
    let cardholderName: string | undefined
    let cardType: string | undefined
    let cardLast4: string | undefined

    try {
      const collectResponse = await client.collectCardData(resolvedReaderId, {})
      const collectOk = collectResponse.cmdStatus === 'Success' || collectResponse.cmdStatus === 'Approved'
      if (collectOk) {
        cardholderName = collectResponse.cardholderName || undefined
        cardType = collectResponse.cardType || undefined
        cardLast4 = collectResponse.cardLast4 || undefined

        // Stage 1: Check if this card is already vaulted and has an open tab
        // TODO: Add OrderCardRepository.findByRecordNo() once that repository exists
        const collectRecordNo = collectResponse.recordNo || null
        if (collectRecordNo) {
          const existing = await db.orderCard.findFirst({
            where: {
              recordNo: collectRecordNo,
              deletedAt: null,
              order: { status: 'open', orderType: 'bar_tab', locationId },
            },
            orderBy: { createdAt: 'desc' },
            include: {
              order: { select: { id: true, tabName: true, orderNumber: true } },
            },
          })
          if (existing) {
            // Reset order status (don't leave it as pending_auth)
            void OrderRepository.updateOrder(orderId, locationId, { tabStatus: 'open' }).catch(() => {})
            return NextResponse.json({
              data: {
                tabStatus: 'existing_tab_found',
                existingTab: {
                  orderId: existing.order.id,
                  tabName: existing.order.tabName ?? `Tab #${existing.order.orderNumber}`,
                  tabNumber: existing.order.orderNumber,
                  authAmount: Number(existing.authAmount),
                  brand: existing.cardType,
                  last4: existing.cardLast4,
                },
              },
            })
          }
        }
      }
    } catch (err) {
      console.warn('[Tab Open] CollectCardData failed, continuing with PreAuth:', err)
    }

    // Step 3: EMVPreAuth for hold amount
    const preAuthResponse = await client.preAuth(resolvedReaderId, {
      invoiceNo: orderId,
      amount: preAuthAmount,
      requestRecordNo: true,
    })

    const preAuthError = parseError(preAuthResponse)
    const approved = preAuthResponse.cmdStatus === 'Approved'

    if (!approved) {
      // Decline — update tab status + queue socket events atomically
      const declineFirstName = normalizeCardholderName(cardholderName)
      await db.$transaction(async (tx) => {
        await OrderRepository.updateOrder(orderId, locationId, {
          tabStatus: 'auth_failed',
          tabName: declineFirstName || order.tabName,
          version: { increment: 1 },
        }, tx)

        // Queue socket events inside transaction for crash safety
        const tabPayload: TabUpdatedPayload = { orderId, status: 'auth_failed' }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.TAB_UPDATED, tabPayload)

        const listPayload: OrdersListChangedPayload = {
          trigger: 'updated',
          orderId,
          tableId: order.tableId || undefined,
        }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)
      })

      // Flush outbox after commit
      void flushSocketOutbox(locationId).catch((err) => {
        console.warn('[open-tab] Outbox flush failed, catch-up will deliver:', err)
      })

      // Event sourcing: record the auth failure as metadata update
      void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
        tabStatus: 'auth_failed',
        tabName: declineFirstName || order.tabName || null,
      }).catch(err => console.error('[order-events] open-tab decline emit failed:', err))

      return NextResponse.json({
        data: {
          approved: false,
          tabStatus: 'auth_failed',
          cardholderName: declineFirstName,
          cardType: cardType || preAuthResponse.cardType,
          cardLast4: cardLast4 || preAuthResponse.cardLast4,
          error: preAuthError
            ? { code: preAuthError.code, message: preAuthError.text, isRetryable: preAuthError.isRetryable }
            : { code: 'DECLINED', message: 'Pre-authorization declined', isRetryable: true },
        },
      })
    }

    // Step 4: Card approved — normalize cardholder name for display (LAST/FIRST → First Last)
    const rawName = cardholderName || preAuthResponse.cardholderName || undefined
    const finalCardholderName = normalizeCardholderName(rawName)
    const finalCardType = cardType || preAuthResponse.cardType || 'unknown'
    const finalCardLast4 = cardLast4 || preAuthResponse.cardLast4 || '????'
    const recordNo = preAuthResponse.recordNo

    if (!recordNo) {
      console.error('[Tab Open] PreAuth approved but no RecordNo returned')
      return NextResponse.json({ error: 'Pre-auth approved but no RecordNo token received' }, { status: 500 })
    }

    // Stage 2 + record: use shared recordTab() for duplicate check, OrderCard creation,
    // Order update, event emission, and socket dispatches.
    try {
      const result = await recordTab({
        locationId,
        orderId,
        readerId: resolvedReaderId,
        recordNo,
        cardType: finalCardType,
        cardLast4: finalCardLast4,
        cardholderName: finalCardholderName,
        authAmount: preAuthAmount,
        authCode: preAuthResponse.authCode,
        tabName: order.tabName || undefined,
        tableId: order.tableId,
        // Datacap metadata for ByRecordNo operations + chargeback defense
        tokenFrequency: 'Recurring',
        acqRefData: preAuthResponse.acqRefData,
        processData: preAuthResponse.processData,
        aid: preAuthResponse.aid,
        cvm: preAuthResponse.cvm ? String(preAuthResponse.cvm) : undefined,
        avsResult: undefined, // Pre-auth doesn't return AVS
        refNo: preAuthResponse.refNo,
      })

      pushUpstream()

      return NextResponse.json({
        data: {
          approved: true,
          tabStatus: 'open',
          cardholderName: finalCardholderName,
          cardType: finalCardType,
          cardLast4: finalCardLast4,
          authAmount: preAuthAmount,
          recordNo,
          orderCardId: result.orderCardId,
        },
      })
    } catch (err) {
      if (err instanceof DuplicateTabError) {
        // Void the new hold -- RecordNo-based, no card present needed
        void client.voidSale(resolvedReaderId, { recordNo }).catch(voidErr =>
          console.error('[Tab Open] Failed to void duplicate hold:', voidErr)
        )
        void OrderRepository.updateOrder(orderId, locationId, { tabStatus: 'open' }).catch(() => {})
        return NextResponse.json({
          data: {
            tabStatus: 'existing_tab_found',
            existingTab: err.existingTab,
          },
        })
      }
      throw err
    }
  } catch (error) {
    console.error('Failed to open tab:', error)

    // PAYMENT-SAFETY: If preAuth timed out or threw, the order is stuck in 'pending_auth'.
    // Reset to 'open' so the tab isn't permanently locked. The card MAY have been charged
    // (ambiguous state if the timeout happened after Datacap processed but before we got the response).
    let failedOrderId = 'unknown'
    try {
      const p = await params
      failedOrderId = p.id
      // Best-effort reset — locationId may not be available, use raw db as fallback
      await db.order.update({
        where: { id: failedOrderId },
        data: { tabStatus: 'open' },
      })
    } catch {
      // Best-effort reset — don't mask the original error
    }

    console.error('[PAYMENT-SAFETY] Ambiguous state', {
      orderId: failedOrderId,
      flow: 'open-tab',
      reason: 'preauth_error_or_timeout',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json({ error: 'Failed to open tab' }, { status: 500 })
  }
})
