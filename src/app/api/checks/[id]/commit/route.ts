/**
 * POST /api/checks/:id/commit
 *
 * Transitions a draft check into a committed, numbered business record.
 * Everything happens inside a SINGLE Prisma interactive transaction:
 *
 *   1. Validate check is draft + terminal holds the editing lease
 *   2. Resolve business date from NUC server clock (location timezone + EOD cutoff)
 *   3. SELECT FOR UPDATE on OrderNumberAllocator row — THE serialization point
 *   4. Increment allocator, assign orderNumber + displayNumber to check
 *   5. Create canonical Order + OrderItems from Check + CheckItems
 *   6. Link Check.orderId → Order.id
 *   7. Write CHECK_COMMITTED event (same txn — no crash window)
 *   8. For dine_in / takeout, also write ORDER_SENT event (same txn)
 *   9. Store ProcessedCommand for idempotency replay (same txn)
 *
 * After commit (fire-and-forget):
 *   - check:committed + checks:list-changed + check:event socket broadcasts
 *   - ORDER_CREATED OrderEvent (for Android event-sourcing)
 *   - orders:list-changed (for KDS + terminals)
 *
 * Hardware (KDS routing, Datacap) is NOT inside this transaction.
 *
 * Idempotent: duplicate commandId replays the stored result.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { ok, err } from '@/lib/api-response'
import { getBusinessDate } from '@/lib/check-events/business-date'
import { dispatchCheckCommitted, dispatchChecksListChanged, dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { emitToLocation } from '@/lib/socket-server'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { allocateOrderNumber } from '@/lib/check-commit/allocate-order-number'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('check-commit')

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: checkId } = await params
    const body = await request.json()
    const { commandId, terminalId, employeeId } = body as {
      commandId?: string
      terminalId?: string
      employeeId?: string
    }

    // ── Input validation ─────────────────────────────────────────────
    if (!commandId) return err('commandId is required')
    if (!terminalId) return err('terminalId is required')
    if (!employeeId) return err('employeeId is required')

    // ── Idempotency gate ─────────────────────────────────────────────
    const existing = await db.processedCommand.findUnique({
      where: { commandId },
    })
    if (existing) {
      log.info({ commandId, checkId }, 'replaying processed command')
      return NextResponse.json(JSON.parse(existing.resultJson))
    }

    // ── Single transaction — this is THE serialization point ─────────
    const result = await db.$transaction(async (tx) => {
      // 1. Load and validate draft check + lease
      const check = await tx.check.findUnique({
        where: { id: checkId },
      })
      if (!check) throw new CommitError('CHECK_NOT_FOUND', 404)
      if (check.status !== 'draft') {
        throw new CommitError(
          check.status === 'committed' ? 'CHECK_ALREADY_COMMITTED' : 'CHECK_NOT_DRAFT',
          409
        )
      }
      if (check.terminalId !== terminalId) {
        throw new CommitError('LEASE_CONFLICT', 409)
      }

      // 2. Get location for timezone + EOD cutoff
      const location = await tx.location.findUnique({
        where: { id: check.locationId },
        select: { timezone: true, settings: true },
      })
      const timezone = location?.timezone || 'America/New_York'
      const settings = location?.settings as Record<string, unknown> | null
      const eodCutoff =
        ((settings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined)
          ? parseInt((settings?.businessDay as Record<string, unknown>)?.dayStartTime as string, 10)
          : 4

      // 3. Determine business date from SERVER clock (NUC authority)
      const businessDate = getBusinessDate(timezone, eodCutoff)

      // 4. SELECT FOR UPDATE on allocator row — serializes concurrent commits
      const orderNumber = await allocateOrderNumber(tx, check.locationId, businessDate)
      const displayNumber = String(orderNumber)

      // 5. Fetch check items for Order creation
      const checkItems = await tx.checkItem.findMany({
        where: { checkId, status: { not: 'removed' } },
      })

      // 6. Create the canonical Order record from Check data
      const order = await tx.order.create({
        data: {
          locationId: check.locationId,
          employeeId,
          orderNumber,
          displayNumber,
          orderType: check.orderType,
          tableId: check.tableId || null,
          tabName: check.tabName || null,
          guestCount: check.guestCount,
          status: 'open',
          notes: check.notes || null,
          isBottleService: check.isBottleService,
          bottleServiceTierId: check.bottleServiceTierId || null,
          businessDayDate: new Date(businessDate + 'T00:00:00'),
          subtotal: 0,
          discountTotal: 0,
          taxTotal: 0,
          taxFromInclusive: 0,
          taxFromExclusive: 0,
          tipTotal: 0,
          total: 0,
          commissionTotal: 0,
          itemCount: checkItems.reduce((sum, ci) => sum + ci.quantity, 0),
        },
      })

      // 7. Create OrderItems from CheckItems (CheckItem.id IS OrderItem.id — stable lineItemId)
      for (const ci of checkItems) {
        await tx.orderItem.create({
          data: {
            id: ci.id,
            orderId: order.id,
            locationId: check.locationId,
            menuItemId: ci.menuItemId,
            name: ci.name,
            price: ci.priceCents / 100,        // Order stores dollars, Check stores cents
            quantity: ci.quantity,
            specialNotes: ci.specialNotes || null,
            seatNumber: ci.seatNumber ?? null,
            courseNumber: ci.courseNumber ?? null,
            isHeld: ci.isHeld,
            blockTimeMinutes: ci.blockTimeMinutes ?? null,
            delayMinutes: ci.delayMinutes ?? null,
            soldByWeight: ci.soldByWeight,
            weight: ci.weight ?? null,
            weightUnit: ci.weightUnit ?? null,
            unitPrice: ci.unitPriceCents != null ? ci.unitPriceCents / 100 : null,
            pourSize: ci.pourSize ?? null,
            pourMultiplier: ci.pourMultiplier ?? null,
            isTaxInclusive: ci.isTaxInclusive,
            pricingOptionId: ci.pricingOptionId ?? null,
            pricingOptionLabel: ci.pricingOptionLabel ?? null,
            itemTotal: ci.priceCents / 100 * ci.quantity,
            modifiers: ci.modifiersJson ? {
              create: (JSON.parse(ci.modifiersJson) as Array<{
                modifierId?: string; name: string; price: number; quantity?: number;
                preModifier?: string; depth?: number; spiritTier?: string;
                linkedBottleProductId?: string; isCustomEntry?: boolean;
                isNoneSelection?: boolean; swapTargetName?: string;
                swapTargetItemId?: string; swapPricingMode?: string;
                swapEffectivePrice?: number;
              }>).map(mod => ({
                locationId: check.locationId,
                modifierId: mod.modifierId || null,
                name: mod.name,
                price: mod.price,
                quantity: mod.quantity ?? 1,
                preModifier: mod.preModifier || null,
                depth: mod.depth ?? 0,
                spiritTier: mod.spiritTier || null,
                linkedBottleProductId: mod.linkedBottleProductId || null,
                isCustomEntry: mod.isCustomEntry || false,
                isNoneSelection: mod.isNoneSelection || false,
                swapTargetName: mod.swapTargetName || null,
                swapTargetItemId: mod.swapTargetItemId || null,
                swapPricingMode: mod.swapPricingMode || null,
                swapEffectivePrice: mod.swapEffectivePrice ?? null,
              })),
            } : undefined,
          },
        })
      }

      // 8. Update check: status → committed, assign orderNumber, link orderId
      const committed = await tx.check.update({
        where: { id: checkId },
        data: {
          status: 'committed',
          orderNumber,
          displayNumber,
          orderId: order.id,
        },
      })

      // 9. Emit CHECK_COMMITTED event (inside txn for consistency — no crash window)
      // Deterministic eventId from commandId — the Android client uses the same convention
      // so INSERT OR IGNORE deduplicates the server echo on the originating terminal.
      const commitEventId = `${commandId}-committed`
      const commitPayload = {
        orderNumber,
        displayNumber,
        businessDate,
        employeeId,
        orderId: order.id,
      }
      const commitEvent = await tx.checkEvent.create({
        data: {
          eventId: commitEventId,
          checkId,
          type: 'CHECK_COMMITTED',
          payloadJson: JSON.stringify(commitPayload),
          commandId,
          deviceId: terminalId,
        },
        select: { serverSequence: true },
      })

      // 10. For dine_in and takeout, items are sent immediately at commit.
      //     CHECK_COMMITTED and ORDER_SENT are DISTINCT events.
      //     For bar_tab, ORDER_SENT fires later (when bartender sends to kitchen).
      let sentItemIds: string[] | null = null
      let orderSentEventResult: { eventId: string; serverSequence: number } | null = null
      if (check.orderType === 'dine_in' || check.orderType === 'takeout') {
        sentItemIds = checkItems.filter(ci => ci.status === 'active').map(ci => ci.id)

        const sentEventId = `${commandId}-sent`
        const sentEvent = await tx.checkEvent.create({
          data: {
            eventId: sentEventId,
            checkId,
            type: 'ORDER_SENT',
            payloadJson: JSON.stringify({
              itemIds: sentItemIds,
            }),
            commandId: commandId + '-sent', // Distinct commandId for ORDER_SENT
            deviceId: terminalId,
          },
          select: { serverSequence: true },
        })
        orderSentEventResult = { eventId: sentEventId, serverSequence: sentEvent.serverSequence }
      }

      // 11. Store idempotency result (SAME transaction — no crash window)
      const resultData = {
        checkId: committed.id,
        orderId: order.id,
        locationId: committed.locationId,
        orderNumber,
        displayNumber,
        orderType: committed.orderType,
        businessDate,
        status: 'committed',
        tableId: committed.tableId,
        itemsSent: sentItemIds,
      }
      await tx.processedCommand.create({
        data: {
          commandId,
          resultJson: JSON.stringify(resultData),
        },
      })

      return {
        ...resultData,
        _commitEvent: { eventId: commitEventId, serverSequence: commitEvent.serverSequence },
        _orderSentEvent: orderSentEventResult,
        _commitPayload: commitPayload,
      }
    })

    // ── AFTER transaction: dispatch socket events (fire-and-forget) ───
    // Hardware / KDS side effects are NOT in the transaction.

    // Check domain events
    void dispatchCheckCommitted(result.locationId, checkId, {
      orderNumber: result.orderNumber,
      displayNumber: result.displayNumber,
      orderType: result.orderType,
      employeeId,
      businessDate: result.businessDate,
      tableId: result.tableId,
      orderId: result.orderId,
    }).catch(e => log.warn({ err: e }, 'dispatchCheckCommitted failed'))

    void dispatchChecksListChanged(result.locationId)
      .catch(e => log.warn({ err: e }, 'dispatchChecksListChanged failed'))

    // Broadcast the raw check events to location for Android event-sourcing sync
    if (result._commitEvent) {
      void emitToLocation(result.locationId, 'check:event', {
        eventId: result._commitEvent.eventId,
        checkId,
        serverSequence: result._commitEvent.serverSequence,
        type: 'CHECK_COMMITTED',
        payload: result._commitPayload,
        commandId,
        deviceId: terminalId,
      }).catch(e => log.warn({ err: e }, 'check:event CHECK_COMMITTED broadcast failed'))
    }

    // Broadcast ORDER_SENT event if items were sent at commit (dine_in/takeout)
    if (result._orderSentEvent) {
      void emitToLocation(result.locationId, 'check:event', {
        eventId: result._orderSentEvent.eventId,
        checkId,
        serverSequence: result._orderSentEvent.serverSequence,
        type: 'ORDER_SENT',
        payload: { itemIds: result.itemsSent },
        commandId: commandId + '-sent',
        deviceId: terminalId,
      }).catch(e => log.warn({ err: e }, 'check:event ORDER_SENT broadcast failed'))
    }

    // Order domain events — the new Order must be visible to KDS, terminals, Android
    void emitOrderEvent(result.locationId, result.orderId, 'ORDER_CREATED', {
      locationId: result.locationId,
      employeeId,
      orderType: result.orderType,
      tableId: result.tableId || null,
      guestCount: 1,
      orderNumber: result.orderNumber,
      displayNumber: result.displayNumber,
    }).catch(e => log.warn({ err: e }, 'ORDER_CREATED event emit failed'))

    void dispatchOpenOrdersChanged(result.locationId, {
      trigger: 'created',
      orderId: result.orderId,
      tableId: result.tableId || undefined,
      orderNumber: result.orderNumber,
      status: 'open',
    }).catch(e => log.warn({ err: e }, 'dispatchOpenOrdersChanged failed'))

    void emitToLocation(result.locationId, 'orders:list-changed', {
      trigger: 'created',
      orderId: result.orderId,
    }).catch(e => log.warn({ err: e }, 'orders:list-changed broadcast failed'))

    log.info(
      { checkId, orderId: result.orderId, orderNumber: result.orderNumber, businessDate: result.businessDate, locationId: result.locationId },
      'check committed — order created'
    )

    // Strip internal event metadata before returning to client
    const { _commitEvent, _orderSentEvent, _commitPayload, ...responseData } = result
    return NextResponse.json(responseData)
  } catch (error) {
    if (error instanceof CommitError) {
      return err(error.message, error.status)
    }
    log.error({ err: error }, '[check-commit] Unhandled error')
    return err('Failed to commit check', 500)
  }
})

class CommitError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'CommitError'
  }
}
