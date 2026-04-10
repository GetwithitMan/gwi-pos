/**
 * Post-Commit Payment Effects
 *
 * All fire-and-forget side effects that run AFTER the payment transaction commits.
 * Each subsection is independently try/caught — failures never cascade.
 *
 * Extracted from: src/app/api/orders/[id]/pay/route.ts (lines ~1076-1956)
 */
import crypto from 'crypto'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as PaymentRepository from '@/lib/repositories/payment-repository'
import { errorCapture } from '@/lib/error-capture'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { roundToCents, toNumber } from '@/lib/pricing'
import {
  dispatchOpenOrdersChanged,
  dispatchFloorPlanUpdate,
  dispatchOrderTotalsUpdate,
  dispatchPaymentProcessed,
  dispatchCFDReceiptSent,
  dispatchOrderClosed,
  dispatchNewOrder,
  dispatchTableStatusChanged,
  dispatchEntertainmentStatusChanged,
  dispatchGiftCardBalanceChanged,
} from '@/lib/socket-dispatch'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { resolveDeliveryTipRecipient } from '@/lib/delivery/tip-reallocation'
import { emitCloudEvent } from '@/lib/cloud-events'
import { triggerCashDrawer } from '@/lib/cash-drawer'
import { CAKE_SETTLEMENT_TYPES } from '@/lib/cake-orders/schemas'
import { OrderRouter } from '@/lib/order-router'
import { batchUpdateOrderItemStatus } from '@/lib/batch-updates'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { printKitchenTicketsForManifests } from '@/lib/print-template-factory'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { resolveDrawerForPayment } from '@/lib/domain/payment'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('payment-post-commit')

// ─── Params Type ──────────────────────────────────────────────────────────────

export interface PostCommitEffectsParams {
  orderId: string
  order: any
  ingestResult: any
  settings: any
  payments: any
  employeeId: string | null
  terminalId: string | null
  allPendingPayments: any[]
  totalTips: number
  newTipTotal: number
  newPaidTotal: number
  effectiveTotal: number
  paidTolerance: number
  orderIsPaid: boolean
  updateData: any
  pointsEarned: number
  newAverageTicket: number | null
  loyaltyEarningBase: number
  shouldUpdateCustomerStats: boolean
  pmsAttemptId: string | null
  pmsTransactionNo: string | null
  unsentItems: any[]
  businessDayStart: string | null
  paymentMutationOrigin: string
  hasCash: boolean
  autoGratApplied: boolean
  autoGratNote: string | null
  isTrainingPayment: boolean
  giftCardBalanceChanges: any[]
  isSplitPayRemaining: boolean
  totalDriftWarning: any
  loyaltyTierMultiplier: number
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function runPaymentPostCommitEffects(params: PostCommitEffectsParams): void {
  const {
    orderId,
    order,
    ingestResult,
    settings,
    employeeId,
    terminalId,
    totalTips,
    newTipTotal,
    newPaidTotal,
    effectiveTotal,
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
  } = params

  // 1. Total drift socket dispatch
  emitTotalDriftWarning(order, orderId, terminalId, totalDriftWarning)

  // 2. Outage mode payment flagging + cloud sync
  handleOutageModeSync(order, orderId, ingestResult)

  // 3. Kitchen auto-send (unsent items)
  autoSendUnsentItems(order, orderId, unsentItems)

  // 4. PMS attempt finalization
  finalizePmsAttempt(pmsAttemptId, pmsTransactionNo)

  // 5. Split family closure — this one is async and feeds into later effects,
  //    so we wrap it to avoid blocking the caller
  void handleSplitFamilyAndRemainingEffects(params).catch(err =>
    log.warn({ err }, 'split family + remaining effects failed')
  )
}

// ─── 1. Total Drift Socket Dispatch ──────────────────────────────────────────

function emitTotalDriftWarning(
  order: any,
  orderId: string,
  terminalId: string | null,
  totalDriftWarning: any,
): void {
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
}

// ─── 2. Outage Mode Payment Flagging + Cloud Sync ────────────────────────────

function handleOutageModeSync(
  order: any,
  orderId: string,
  ingestResult: any,
): void {
  if (!isInOutageMode()) return

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
  void (async () => {
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
  })().catch(err => console.error('[CRITICAL-PAYMENT] Outage sync block failed:', err))
}

// ─── 3. Kitchen Auto-Send (Unsent Items) ─────────────────────────────────────

function autoSendUnsentItems(
  order: any,
  orderId: string,
  unsentItems: any[],
): void {
  if (unsentItems.length === 0) return

  const autoSendIds = unsentItems
    .filter((i: any) => i.menuItem?.itemType !== 'timed_rental')
    .map((i: any) => i.id)
  if (autoSendIds.length === 0) return

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
      console.error('[pay] Auto-send to kitchen failed:', caughtErr)
    }
  })()
}

// ─── 4. PMS Attempt Finalization ─────────────────────────────────────────────

function finalizePmsAttempt(
  pmsAttemptId: string | null,
  pmsTransactionNo: string | null,
): void {
  if (pmsAttemptId && pmsTransactionNo) {
    void db.pmsChargeAttempt.update({
      where: { id: pmsAttemptId },
      data: { status: 'COMPLETED', operaTransactionId: pmsTransactionNo },
    }).catch(err => console.error('[pay/room_charge] Failed to mark attempt COMPLETED:', err))
  }
}

// ─── 5–16. Async Effects (split family feeds into remaining) ─────────────────

async function handleSplitFamilyAndRemainingEffects(params: PostCommitEffectsParams): Promise<void> {
  const {
    orderId,
    order,
    ingestResult,
    settings,
    employeeId,
    terminalId,
    totalTips,
    newTipTotal,
    newPaidTotal,
    effectiveTotal,
    orderIsPaid,
    updateData,
    pointsEarned,
    newAverageTicket,
    loyaltyEarningBase,
    shouldUpdateCustomerStats,
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
  } = params

  // 5. Split family closure
  let parentWasMarkedPaid = false
  let parentTableId: string | null = null
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

  // 6. Customer & loyalty updates
  updateCustomerAndLoyalty(order, orderId, orderIsPaid, shouldUpdateCustomerStats, pointsEarned, newAverageTicket, loyaltyEarningBase, loyaltyTierMultiplier, employeeId)

  // 7. Audit logs (payment + closure)
  createPaymentAuditLogs(order, orderId, ingestResult, employeeId, orderIsPaid, newPaidTotal)

  // 8. Post-payment order update (businessDayDate, tipTotal, version)
  await runPostPaymentOrderUpdate(order, orderId, orderIsPaid, updateData, businessDayStart, newTipTotal, paymentMutationOrigin)

  // Dispatch socket events when parent order was auto-closed (after transaction commit)
  emitParentClosureEvents(order, terminalId, parentWasMarkedPaid, parentTableId)

  // 9. Entertainment reset (timed_rental items, floor plan)
  if (orderIsPaid) {
    await resetEntertainmentItems(order, orderId)
  }

  // 10. Inventory deduction outbox
  if (orderIsPaid) {
    await createInventoryDeductionOutbox(order, orderId, ingestResult)
  }

  // 11. Commission recalculation
  if (orderIsPaid) {
    recalculateCommission(order, orderId, paymentMutationOrigin)
  }

  // 12. Cash drawer kick + audit
  if (orderIsPaid && hasCash) {
    kickCashDrawerAndAudit(order, orderId, employeeId, terminalId)
  }

  // 13. Tip allocation
  if (orderIsPaid) {
    await allocateTips(order, orderId, ingestResult, settings, employeeId, totalTips, autoGratApplied, isTrainingPayment)
  }

  // 14. Table release
  if (orderIsPaid) {
    releaseTable(order, orderId, orderIsPaid)
  }

  // 15. Socket emissions (totals, payment processed, gift card, order closed)
  emitSocketEvents(order, orderId, ingestResult, employeeId, terminalId, totalTips, newTipTotal, orderIsPaid, giftCardBalanceChanges, parentWasMarkedPaid)

  // Release order claim after successful payment (fire-and-forget)
  if (orderIsPaid) {
    void db.$executeRaw`
      UPDATE "Order" SET "claimedByEmployeeId" = NULL, "claimedByTerminalId" = NULL, "claimedAt" = NULL WHERE id = ${orderId}
    `.catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
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

  // 16. Cloud events, integrations, upstream sync, receipt
  emitCloudEvents(order, orderId, ingestResult, settings, employeeId, newTipTotal, orderIsPaid, pointsEarned)

  // Auto-send email receipt for online orders (fire-and-forget)
  autoSendEmailReceipt(order, orderIsPaid)

  // Cake settlement post-payment hook (fire-and-forget)
  handleCakeSettlement(order, ingestResult, orderIsPaid)

  // Trigger upstream sync (fire-and-forget, debounced)
  pushUpstream()

  // Card recognition: fire-and-forget
  handleCardRecognition(order, orderId, ingestResult, settings)
}

// ─── 6. Customer & Loyalty Updates ───────────────────────────────────────────

function updateCustomerAndLoyalty(
  order: any,
  orderId: string,
  orderIsPaid: boolean,
  shouldUpdateCustomerStats: boolean,
  pointsEarned: number,
  newAverageTicket: number | null,
  loyaltyEarningBase: number,
  loyaltyTierMultiplier: number,
  employeeId: string | null,
): void {
  if (!(orderIsPaid && shouldUpdateCustomerStats && order.customer)) return

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
        console.error('Post-ingestion loyalty transaction/tier check failed:', caughtErr)
      }
    })()
  }
}

// ─── 7. Audit Logs (Payment + Closure) ───────────────────────────────────────

function createPaymentAuditLogs(
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

// ─── 8. Post-Payment Order Update ────────────────────────────────────────────

async function runPostPaymentOrderUpdate(
  order: any,
  orderId: string,
  orderIsPaid: boolean,
  updateData: any,
  businessDayStart: string | null,
  newTipTotal: number,
  paymentMutationOrigin: string,
): Promise<void> {
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
    console.error('[CRITICAL-PAYMENT] Post-payment order update failed, retrying:', caughtErr)
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
}

// ─── Parent Closure Events ───────────────────────────────────────────────────

function emitParentClosureEvents(
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

async function resetEntertainmentItems(
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

// ─── 10. Inventory Deduction Outbox ──────────────────────────────────────────

async function createInventoryDeductionOutbox(
  order: any,
  orderId: string,
  ingestResult: any,
): Promise<void> {
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
    console.error('[Pay] Failed to create PendingDeduction outbox row:', caughtErr)
  }

  // Best-effort async processing (non-blocking)
  void (async () => {
    try {
      const { processNextDeduction } = await import('@/lib/deduction-processor')
      await processNextDeduction()
    } catch (caughtErr) {
      console.error('[Pay] Best-effort deduction trigger failed (outbox will retry):', caughtErr)
    }
  })()
}

// ─── 11. Commission Recalculation ────────────────────────────────────────────

function recalculateCommission(
  order: any,
  orderId: string,
  paymentMutationOrigin: string,
): void {
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
      console.error('[Pay] Commission recalculation failed:', caughtErr)
    }
  })()
}

// ─── 12. Cash Drawer Kick + Audit ────────────────────────────────────────────

function kickCashDrawerAndAudit(
  order: any,
  orderId: string,
  employeeId: string | null,
  terminalId: string | null,
): void {
  // Kick cash drawer on cash payments (Skill 56) — fire-and-forget
  // Failure must never fail the payment response
  // Pass terminalId so the drawer kicks on THIS terminal's printer, not the location default
  void triggerCashDrawer(order.locationId, terminalId || undefined).catch(err => log.warn({ err }, 'cash drawer trigger failed'))
  void (async () => {
    const localDrawer = await resolveDrawerForPayment('cash', employeeId || null, terminalId ?? undefined)
    if (localDrawer.drawerId && employeeId) {
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
        console.error('[Pay] Manager drawer access audit failed:', caughtErr)
      }
    }
  })().catch(err => log.warn({ err }, 'cash drawer audit failed'))
}

// ─── 13. Tip Allocation ──────────────────────────────────────────────────────

async function allocateTips(
  order: any,
  orderId: string,
  ingestResult: any,
  settings: any,
  employeeId: string | null,
  totalTips: number,
  autoGratApplied: boolean,
  isTrainingPayment: boolean,
): Promise<void> {
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
      console.error('[Pay] Delivery tip recipient resolution failed, using default:', caughtErr)
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
}

// ─── 14. Table Release ───────────────────────────────────────────────────────

function releaseTable(
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

function emitSocketEvents(
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

function emitCloudEvents(
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

function autoSendEmailReceipt(
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

function handleCakeSettlement(
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

function handleCardRecognition(
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
