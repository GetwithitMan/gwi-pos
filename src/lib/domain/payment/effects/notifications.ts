/**
 * Notification & Event Effects
 *
 * - Audit logs (payment + closure)
 * - Parent closure events
 * - Entertainment reset (timed_rental items, floor plan)
 * - Table release
 * - Socket emissions (totals, payment processed, gift card, order closed)
 * - Cloud events, integrations, upstream sync, receipt
 * - Auto email receipt
 * - Cake settlement
 * - Card recognition
 * - Order claim release
 * - Notification pager release
 * - CFD receipt
 */
import { db } from '@/lib/db'
import { toNumber } from '@/lib/pricing'
import {
  dispatchOpenOrdersChanged,
  dispatchFloorPlanUpdate,
  dispatchOrderTotalsUpdate,
  dispatchPaymentProcessed,
  dispatchCFDReceiptSent,
  dispatchOrderClosed,
  dispatchTableStatusChanged,
  dispatchEntertainmentStatusChanged,
  dispatchGiftCardBalanceChanged,
} from '@/lib/socket-dispatch'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'
import { emitCloudEvent } from '@/lib/cloud-events'
import { CAKE_SETTLEMENT_TYPES } from '@/lib/cake-orders/schemas'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('payment-effects-notifications')

// ─── 7. Audit Logs (Payment + Closure) ───────────────────────────────────────

export function createPaymentAuditLogs(
  order: any,
  orderId: string,
  ingestResult: any,
  employeeId: string | null,
  orderIsPaid: boolean,
  newPaidTotal: number,
): void {
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
}

// ─── Parent Closure Events ───────────────────────────────────────────────────

export function emitParentClosureEvents(
  order: any,
  terminalId: string | null,
  parentWasMarkedPaid: boolean,
  parentTableId: string | null,
): void {
  if (!parentWasMarkedPaid) return

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

// ─── 9. Entertainment Reset ──────────────────────────────────────────────────

export async function resetEntertainmentItems(
  order: any,
  orderId: string,
): Promise<void> {
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
}

// ─── 14. Table Release ───────────────────────────────────────────────────────

export function releaseTable(
  order: any,
  orderId: string,
  orderIsPaid: boolean,
): void {
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
        console.error('[Pay] Table status reset failed:', caughtErr)
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

// ─── 15. Socket Emissions ────────────────────────────────────────────────────

export function emitSocketEvents(
  order: any,
  orderId: string,
  ingestResult: any,
  employeeId: string | null,
  terminalId: string | null,
  totalTips: number,
  newTipTotal: number,
  orderIsPaid: boolean,
  giftCardBalanceChanges: any[],
  parentWasMarkedPaid: boolean,
): void {
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
}

// ─── 16. Cloud Events, Integrations, Upstream Sync, Receipt ──────────────────

export function emitCloudEvents(
  order: any,
  orderId: string,
  ingestResult: any,
  settings: any,
  employeeId: string | null,
  newTipTotal: number,
  orderIsPaid: boolean,
  pointsEarned: number,
): void {
  // Emit cloud event for fully paid orders (fire-and-forget)
  if (!orderIsPaid) return

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

// ─── Auto Email Receipt ──────────────────────────────────────────────────────

export function autoSendEmailReceipt(
  order: any,
  orderIsPaid: boolean,
): void {
  // Auto-send email receipt for online orders (fire-and-forget)
  // Online orders (pickup, delivery, online) with a customer email get an automatic receipt
  if (!(orderIsPaid && order.orderType && ['online', 'pickup', 'delivery'].includes(order.orderType))) return

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

// ─── Cake Settlement ─────────────────────────────────────────────────────────

export function handleCakeSettlement(
  order: any,
  ingestResult: any,
  orderIsPaid: boolean,
): void {
  // Cake settlement post-payment hook (fire-and-forget)
  if (!(orderIsPaid && order.orderType && CAKE_SETTLEMENT_TYPES.includes(order.orderType as any))) return

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
      console.error('[Pay] Cake settlement completion hook failed:', caughtErr)
    }
  })()
}

// ─── Card Recognition ────────────────────────────────────────────────────────

export function handleCardRecognition(
  order: any,
  orderId: string,
  ingestResult: any,
  settings: any,
): void {
  // Card recognition: fire-and-forget BEFORE response return.
  // Sends a separate socket event instead of blocking the HTTP response (-10-50ms).
  if (!(!order.customer?.id && settings.tabs?.cardRecognitionEnabled)) return

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
      log.warn({ err: caughtErr }, 'Card recognition fire-and-forget failed')
    }
  })()
}

// ─── Order Claim Release ─────────────────────────────────────────────────────

export function releaseOrderClaim(
  order: any,
  orderId: string,
  orderIsPaid: boolean,
): void {
  if (orderIsPaid) {
    void db.$executeRaw`
      UPDATE "Order" SET "claimedByEmployeeId" = NULL, "claimedByTerminalId" = NULL, "claimedAt" = NULL WHERE id = ${orderId}
    `.catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
  }
}

// ─── Notification Pager Release ──────────────────────────────────────────────

export function releaseNotificationAssignments(
  order: any,
  employeeId: string | null,
  orderIsPaid: boolean,
): void {
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
}

// ─── CFD Receipt Sent ────────────────────────────────────────────────────────

export function notifyCFDReceiptSent(
  order: any,
  orderIsPaid: boolean,
): void {
  if (orderIsPaid) {
    dispatchCFDReceiptSent(order.locationId, null, {
      orderId: order.id,
      total: toNumber(order.total ?? 0),
    })
  }
}

// ─── Trigger Upstream Sync ───────────────────────────────────────────────────

export function triggerUpstreamSync(): void {
  pushUpstream()
}
