/**
 * Post-Payment Side Effects
 *
 * All fire-and-forget work that runs AFTER the payment transaction commits.
 * Each function is independently retryable and must never fail the payment response.
 */

import crypto from 'crypto'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as PaymentRepository from '@/lib/repositories/payment-repository'
import { roundToCents, toNumber } from '@/lib/pricing'
import { errorCapture } from '@/lib/error-capture'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import {
  dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchOrderTotalsUpdate,
  dispatchPaymentProcessed, dispatchCFDReceiptSent, dispatchOrderClosed,
  dispatchTableStatusChanged, dispatchEntertainmentStatusChanged,
  dispatchGiftCardBalanceChanged, dispatchNewOrder,
} from '@/lib/socket-dispatch'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { resolveDeliveryTipRecipient } from '@/lib/delivery/tip-reallocation'
import { emitCloudEvent } from '@/lib/cloud-events'
import { triggerCashDrawer, emitDrawerOpenedEvent } from '@/lib/cash-drawer'
import { batchUpdateOrderItemStatus } from '@/lib/batch-updates'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { printKitchenTicketsForManifests } from '@/lib/print-template-factory'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { resolveDrawerForPayment } from '@/lib/domain/payment'
import { OrderRouter } from '@/lib/order-router'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('pay-effects')

/**
 * Context passed from the main route into post-payment effects.
 * Contains everything needed for the fire-and-forget work.
 */
export interface PostPaymentContext {
  orderId: string
  order: any // Full order with includes
  settings: any
  ingestResult: any
  payments: Array<{ method: string; amount: number; tipAmount?: number }>
  employeeId: string | null
  terminalId: string | null
  totalTips: number
  newTipTotal: number
  newPaidTotal: number
  effectiveTotal: number
  paidTolerance: number
  orderIsPaid: boolean
  pointsEarned: number
  newAverageTicket: number | null
  loyaltyEarningBase: number
  loyaltyTierMultiplier: number
  shouldUpdateCustomerStats: boolean
  pmsAttemptId: string | null
  pmsTransactionNo: string | null
  unsentItems: any[]
  businessDayStart: Date
  paymentMutationOrigin: string
  hasCash: boolean
  autoGratApplied: boolean
  autoGratNote: string | null
  isTrainingPayment: boolean
  giftCardBalanceChanges: Array<{ giftCardId: string; newBalance: number }>
  isSplitPayRemaining: boolean
}

// ─── R3: Total Drift Detection ──────────────────────────────────────────────

export function detectTotalDrift(ctx: PostPaymentContext): void {
  void (async () => {
    try {
      // eslint-disable-next-line no-restricted-syntax
      const currentOrder = await db.order.findUnique({
        where: { id: ctx.orderId },
        select: { total: true },
      })
      if (!currentOrder) return
      const capturedTotal = toNumber(ctx.order.total ?? 0)
      const currentTotal = toNumber(currentOrder.total ?? 0)
      const drift = roundToCents(currentTotal - capturedTotal)
      if (drift > 0.01) {
        log.warn({ orderId: ctx.orderId, capturedTotal, currentTotal, drift },
          'R3: Payment captured on stale order total -- customer may have underpaid')
        await db.auditLog.create({
          data: {
            locationId: ctx.order.locationId,
            employeeId: ctx.employeeId || null,
            action: 'TOTAL_DRIFT_DETECTED',
            entityType: 'order',
            entityId: ctx.orderId,
            details: JSON.stringify({
              orderNumber: ctx.order.orderNumber,
              capturedTotal,
              currentTotal,
              drift,
              paymentIds: ctx.ingestResult.bridgedPayments.map((bp: { id: string }) => bp.id),
              message: `Payment captured at $${capturedTotal.toFixed(2)} but order total is now $${currentTotal.toFixed(2)} (underpaid by $${drift.toFixed(2)})`,
            }),
          },
        })
        void dispatchPaymentProcessed(ctx.order.locationId, {
          orderId: ctx.orderId,
          status: 'total_drift_warning',
          totalDriftDetected: true,
          capturedTotal,
          currentTotal,
          drift,
          sourceTerminalId: ctx.terminalId || undefined,
        } as any).catch(err => log.warn({ err }, 'R3: total drift socket dispatch failed'))
      }
    } catch (caughtErr) {
      log.warn({ err: caughtErr, orderId: ctx.orderId }, 'R3: Total drift detection failed (non-blocking)')
    }
  })()
}

// ─── Outage Queue Writes ─────────────────────────────────────────────────

export function handleOutageQueueWrites(ctx: PostPaymentContext): void {
  if (!isInOutageMode()) return

  const paymentIds = ctx.ingestResult.bridgedPayments.map((bp: { id: string }) => bp.id)
  if (paymentIds.length > 0) {
    for (const pid of paymentIds) {
      void PaymentRepository.updatePayment(pid, ctx.order.locationId, { needsReconciliation: true })
        .catch(err => console.error('[CRITICAL-PAYMENT] Failed to flag payment for reconciliation:', err))
    }
  }

  void (async () => {
    const fullPayments = await Promise.all(
      (paymentIds as string[]).map((pid: string) => PaymentRepository.getPaymentById(pid, ctx.order.locationId))
    ).then(results => results.filter((p): p is NonNullable<typeof p> => p !== null))
    for (const fp of fullPayments) {
      void queueOutageWrite('Payment', fp.id, 'INSERT', fp as unknown as Record<string, unknown>, ctx.order.locationId).catch(async (err) => {
        console.error(`[CRITICAL-PAYMENT] Outage queue write failed for Payment ${fp.id}, retrying:`, err)
        try { await queueOutageWrite('Payment', fp.id, 'INSERT', fp as unknown as Record<string, unknown>, ctx.order.locationId) } catch (retryErr) {
          console.error(`[CRITICAL-PAYMENT] Outage queue write retry FAILED for Payment ${fp.id}:`, retryErr)
        }
      })
    }
    const fullOrder = await OrderRepository.getOrderById(ctx.orderId, ctx.order.locationId)
    if (fullOrder) {
      void queueOutageWrite('Order', ctx.orderId, 'UPDATE', fullOrder as unknown as Record<string, unknown>, ctx.order.locationId).catch(async (err) => {
        console.error(`[CRITICAL-PAYMENT] Outage queue write failed for Order ${ctx.orderId}, retrying:`, err)
        try { await queueOutageWrite('Order', ctx.orderId, 'UPDATE', fullOrder as unknown as Record<string, unknown>, ctx.order.locationId) } catch (retryErr) {
          console.error(`[CRITICAL-PAYMENT] Outage queue write retry FAILED for Order ${ctx.orderId}:`, retryErr)
        }
      })
    }
  })()
}

// ─── Auto-Send Unsent Items to Kitchen ──────────────────────────────────

export function autoSendUnsentItems(ctx: PostPaymentContext): void {
  if (ctx.unsentItems.length === 0) return

  const autoSendIds = ctx.unsentItems
    .filter((i: any) => i.menuItem?.itemType !== 'timed_rental')
    .map((i: any) => i.id)
  if (autoSendIds.length === 0) return

  void (async () => {
    try {
      const now = new Date()
      await batchUpdateOrderItemStatus(autoSendIds, 'sent', now)
      const routingResult = await OrderRouter.resolveRouting(ctx.orderId, autoSendIds)
      void dispatchNewOrder(ctx.order.locationId, routingResult, { async: true }).catch((err: unknown) => log.warn({ err }, 'Background task failed'))
      void printKitchenTicketsForManifests(routingResult, ctx.order.locationId).catch((err: unknown) => log.warn({ err }, 'Background task failed'))
      void deductPrepStockForOrder(ctx.orderId, autoSendIds).catch((err: unknown) => log.warn({ err }, 'Background task failed'))
      void emitOrderEvent(ctx.order.locationId, ctx.orderId, 'ORDER_SENT', { sentItemIds: autoSendIds })
    } catch (caughtErr) {
      console.error('[pay] Auto-send to kitchen failed:', caughtErr)
    }
  })()
}

// ─── PMS Attempt Completion ─────────────────────────────────────────────

export function completePmsAttempt(ctx: PostPaymentContext): void {
  if (ctx.pmsAttemptId && ctx.pmsTransactionNo) {
    void db.pmsChargeAttempt.update({
      where: { id: ctx.pmsAttemptId },
      data: { status: 'COMPLETED', operaTransactionId: ctx.pmsTransactionNo },
    }).catch(err => console.error('[pay/room_charge] Failed to mark attempt COMPLETED:', err))
  }
}

// ─── Split Family Closure ───────────────────────────────────────────────

export async function handleSplitFamilyClosure(ctx: PostPaymentContext): Promise<{
  parentWasMarkedPaid: boolean
  parentTableId: string | null
}> {
  const isSplitFamilyMember = ctx.order.parentOrderId || ctx.isSplitPayRemaining
  if (!ctx.orderIsPaid || !isSplitFamilyMember) {
    return { parentWasMarkedPaid: false, parentTableId: null }
  }

  try {
    const { computeSplitFamilyBalance } = await import('@/lib/domain/split-order/family-balance')
    const { closeSplitFamily } = await import('@/lib/domain/split-order/close-family')
    const rootId = (ctx.order as any).splitFamilyRootId || ctx.order.parentOrderId || ctx.orderId
    const family = await computeSplitFamilyBalance(db, rootId, ctx.order.locationId)
    if (family.isFullyPaid) {
      await closeSplitFamily(db, rootId, ctx.order.locationId)
      return { parentWasMarkedPaid: true, parentTableId: ctx.order.tableId ?? null }
    }
  } catch (caughtErr) {
    console.error('[Pay] Split family closure check failed:', caughtErr)
  }

  return { parentWasMarkedPaid: false, parentTableId: null }
}

// ─── Customer Stats + Loyalty ──────────────────────────────────────────

export function updateCustomerStatsAndLoyalty(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid || !ctx.shouldUpdateCustomerStats || !ctx.order.customer) return

  void db.customer.update({
    where: { id: ctx.order.customer.id },
    data: {
      ...(ctx.pointsEarned > 0 ? { loyaltyPoints: { increment: ctx.pointsEarned }, lifetimePoints: { increment: ctx.pointsEarned } } : {}),
      totalSpent: { increment: toNumber(ctx.order.total ?? 0) },
      totalOrders: { increment: 1 },
      lastVisit: new Date(),
      averageTicket: ctx.newAverageTicket!,
      lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
    },
  }).catch(err => console.error('Post-ingestion customer/loyalty update failed:', err))

  // Create LoyaltyTransaction record + check tier promotion
  if (ctx.pointsEarned > 0) {
    void (async () => {
      try {
        const custId = ctx.order.customer!.id
        const currentPoints = Number((ctx.order.customer as any).loyaltyPoints ?? 0)
        const currentLifetime = Number((ctx.order.customer as any).lifetimePoints ?? 0)
        const txnId = crypto.randomUUID()
        const balanceAfter = currentPoints + ctx.pointsEarned
        const loyaltyDesc = `Earned ${ctx.pointsEarned} points on order #${ctx.order.orderNumber}${ctx.loyaltyTierMultiplier > 1 ? ` (${ctx.loyaltyTierMultiplier}x tier)` : ''}`
        const loyaltyEmpId = ctx.employeeId || null
        await db.$executeRaw`
          INSERT INTO "LoyaltyTransaction" (
            "id", "customerId", "locationId", "orderId", "type", "points",
            "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
          ) VALUES (${txnId}, ${custId}, ${ctx.order.locationId}, ${ctx.orderId}, 'earn', ${ctx.pointsEarned},
          ${currentPoints}, ${balanceAfter},
          ${loyaltyDesc},
          ${loyaltyEmpId}, NOW())
        `
        // Check tier promotion
        const newLifetime = currentLifetime + ctx.pointsEarned
        const custProgramId = (ctx.order.customer as any).loyaltyProgramId
        if (custProgramId) {
          const tiers = await db.$queryRaw<Array<{ id: string; name: string; minimumPoints: number }>>`
            SELECT "id", "name", "minimumPoints" FROM "LoyaltyTier"
             WHERE "programId" = ${custProgramId} AND "deletedAt" IS NULL ORDER BY "minimumPoints" DESC
          `
          const currentTierId = (ctx.order.customer as any).loyaltyTierId
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

// ─── Audit Logs ─────────────────────────────────────────────────────────

export function createPaymentAuditLogs(ctx: PostPaymentContext): void {
  for (const bp of ctx.ingestResult.bridgedPayments) {
    void db.auditLog.create({
      data: {
        locationId: ctx.order.locationId,
        employeeId: ctx.employeeId || null,
        action: 'payment_processed',
        entityType: 'payment',
        entityId: bp.id,
        details: {
          paymentMethod: bp.paymentMethod,
          amount: bp.amount,
          tipAmount: bp.tipAmount,
          orderId: ctx.orderId,
          orderNumber: ctx.order.orderNumber,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))
  }

  if (ctx.orderIsPaid) {
    void db.auditLog.create({
      data: {
        locationId: ctx.order.locationId,
        employeeId: ctx.employeeId || null,
        action: 'order_closed',
        entityType: 'order',
        entityId: ctx.orderId,
        details: {
          orderNumber: ctx.order.orderNumber,
          totalPaid: ctx.newPaidTotal,
          paymentCount: ctx.ingestResult.bridgedPayments.length,
          paymentMethods: [...new Set(ctx.ingestResult.bridgedPayments.map((p: any) => p.paymentMethod))],
        } as any,
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))
  }
}

// ─── Post-Payment Order Update ──────────────────────────────────────────

export async function updateOrderPostPayment(ctx: PostPaymentContext, updateData: any): Promise<void> {
  const postPaymentOrderUpdate = ctx.orderIsPaid
    ? {
        businessDayDate: ctx.businessDayStart,
        primaryPaymentMethod: updateData.primaryPaymentMethod,
        tipTotal: ctx.newTipTotal,
        version: { increment: 1 } as const,
        lastMutatedBy: ctx.paymentMutationOrigin,
      }
    : {
        tipTotal: ctx.newTipTotal,
        ...(updateData.primaryPaymentMethod ? { primaryPaymentMethod: updateData.primaryPaymentMethod } : {}),
        lastMutatedBy: ctx.paymentMutationOrigin,
      }

  try {
    await OrderRepository.updateOrder(ctx.orderId, ctx.order.locationId, postPaymentOrderUpdate)
  } catch (caughtErr) {
    console.error('[CRITICAL-PAYMENT] Post-payment order update failed, retrying:', caughtErr)
    try {
      const { version: _v, ...retryData } = postPaymentOrderUpdate as any
      await OrderRepository.updateOrder(ctx.orderId, ctx.order.locationId, { ...retryData, lastMutatedBy: ctx.paymentMutationOrigin })
    } catch (retryErr) {
      console.error('[CRITICAL-PAYMENT] Post-payment order update retry FAILED -- order will have stale report fields:', retryErr)
      void errorCapture.critical('PAYMENT', 'Post-payment order update failed after retry', {
        category: 'payment-post-update-error',
        action: 'Updating order fields after payment',
        orderId: ctx.orderId,
        error: retryErr instanceof Error ? retryErr : undefined,
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
    }
  }
}

// ─── Split Parent Socket Events ─────────────────────────────────────────

export function dispatchSplitParentEvents(
  ctx: PostPaymentContext,
  parentWasMarkedPaid: boolean,
  parentTableId: string | null,
): void {
  if (!parentWasMarkedPaid) return

  void dispatchOpenOrdersChanged(ctx.order.locationId, {
    trigger: 'paid',
    orderId: ctx.order.parentOrderId!,
    tableId: parentTableId || undefined,
    sourceTerminalId: ctx.terminalId || undefined,
  }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
  void dispatchFloorPlanUpdate(ctx.order.locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
  invalidateSnapshotCache(ctx.order.locationId)

  void dispatchPaymentProcessed(ctx.order.locationId, {
    orderId: ctx.order.parentOrderId!,
    status: 'closed',
    isClosed: true,
    parentAutoClose: true,
    sourceTerminalId: ctx.terminalId || undefined,
  }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))

  if (parentTableId) {
    void db.table.update({
      where: { id: parentTableId },
      data: { status: 'available' },
    }).then(() => {
      invalidateSnapshotCache(ctx.order.locationId)
      void dispatchTableStatusChanged(ctx.order.locationId, { tableId: parentTableId!, status: 'available' }).catch(err => log.warn({ err }, 'Background task failed'))
    }).catch(err => {
      console.error('[Pay] Parent table status reset failed:', err)
    })
  }
}

// ─── Entertainment Reset ────────────────────────────────────────────────

export function resetEntertainmentItems(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid) return

  void (async () => {
    try {
      // eslint-disable-next-line no-restricted-syntax
      const entertainmentItems = await db.menuItem.findMany({
        where: { locationId: ctx.order.locationId, currentOrderId: ctx.orderId, itemType: 'timed_rental' },
        select: { id: true },
      })

      if (entertainmentItems.length === 0) return

      // Clear blockTimeStartedAt on order items
      // eslint-disable-next-line no-restricted-syntax
      await db.orderItem.updateMany({
        where: { orderId: ctx.orderId, locationId: ctx.order.locationId, menuItem: { itemType: 'timed_rental' }, blockTimeStartedAt: { not: null } },
        data: { blockTimeStartedAt: null },
      })

      // eslint-disable-next-line no-restricted-syntax
      await db.menuItem.updateMany({
        where: { locationId: ctx.order.locationId, currentOrderId: ctx.orderId, itemType: 'timed_rental' },
        data: {
          entertainmentStatus: 'available',
          currentOrderId: null,
          currentOrderItemId: null,
        },
      })

      // Reset FloorPlanElements
      for (const item of entertainmentItems) {
        await db.floorPlanElement.updateMany({
          where: { locationId: ctx.order.locationId, linkedMenuItemId: item.id, deletedAt: null, status: 'in_use' },
          data: {
            status: 'available',
            currentOrderId: null,
            sessionStartedAt: null,
            sessionExpiresAt: null,
          },
        })
      }

      // Dispatch socket events + notify waitlist
      void dispatchFloorPlanUpdate(ctx.order.locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
      for (const item of entertainmentItems) {
        void dispatchEntertainmentStatusChanged(ctx.order.locationId, {
          itemId: item.id,
          entertainmentStatus: 'available',
          currentOrderId: null,
          expiresAt: null,
        }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
        void notifyNextWaitlistEntry(ctx.order.locationId, item.id).catch(err => log.warn({ err }, 'waitlist notify failed'))
      }
    } catch (entertainmentErr) {
      console.error('[Pay] Failed to reset entertainment items:', entertainmentErr)
    }
  })()
}

// ─── Inventory Deduction Outbox ─────────────────────────────────────────

export function createInventoryDeduction(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid) return

  void (async () => {
    try {
      const firstPaymentId = ctx.ingestResult.bridgedPayments[0]?.id ?? null
      const existingDeduction = await db.pendingDeduction.findUnique({ where: { orderId: ctx.orderId } })
      if (!existingDeduction) {
        await db.pendingDeduction.create({
          data: {
            locationId: ctx.order.locationId,
            orderId: ctx.orderId,
            paymentId: firstPaymentId,
            deductionType: 'order_deduction',
            status: 'pending',
          },
        })
      } else if (existingDeduction.status !== 'succeeded' && existingDeduction.status !== 'dead') {
        await db.pendingDeduction.update({
          where: { orderId: ctx.orderId },
          data: {
            paymentId: firstPaymentId,
            status: 'pending',
            availableAt: new Date(),
            lastError: null,
          },
        })
      }
    } catch (caughtErr) {
      console.error('[Pay] Failed to create PendingDeduction outbox row:', caughtErr)
    }

    // Best-effort async processing (non-blocking)
    try {
      const { processNextDeduction } = await import('@/lib/deduction-processor')
      await processNextDeduction()
    } catch (caughtErr) {
      console.error('[Pay] Best-effort deduction trigger failed (outbox will retry):', caughtErr)
    }
  })()
}

// ─── Commission Recalculation ───────────────────────────────────────────

export function recalculateCommissions(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid) return

  void (async () => {
    try {
      // eslint-disable-next-line no-restricted-syntax
      const activeItems = await db.orderItem.findMany({
        where: { orderId: ctx.orderId, locationId: ctx.order.locationId, status: 'active', deletedAt: null },
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
        params.push(ctx.paymentMutationOrigin)
        await db.$executeRawUnsafe(
          `UPDATE "OrderItem" SET "commissionAmount" = CASE ${caseClauses} END, "updatedAt" = NOW(), "lastMutatedBy" = $${mutOriginIdx} WHERE id IN (${idPlaceholders})`,
          ...params
        )
      }

      const currentTotal = toNumber(ctx.order.commissionTotal ?? 0)
      if (Math.abs(recalculatedCommission - currentTotal) > 0.001) {
        await OrderRepository.updateOrder(ctx.orderId, ctx.order.locationId, {
          commissionTotal: recalculatedCommission, lastMutatedBy: ctx.paymentMutationOrigin,
        })
      }
    } catch (caughtErr) {
      console.error('[Pay] Commission recalculation failed:', caughtErr)
    }
  })()
}

// ─── Cash Drawer + Manager Audit ────────────────────────────────────────

export function handleCashDrawer(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid || !ctx.hasCash) return

  void triggerCashDrawer(ctx.order.locationId, ctx.terminalId || undefined).catch(err => log.warn({ err }, 'cash drawer trigger failed'))

  // ── Audit log: DRAWER_OPENED with reason cash_payment (fire-and-forget) ──
  if (ctx.employeeId) {
    void db.auditLog.create({
      data: {
        locationId: ctx.order.locationId,
        employeeId: ctx.employeeId,
        action: 'DRAWER_OPENED',
        entityType: 'drawer',
        details: {
          reason: 'cash_payment',
          reasonLabel: 'Cash Payment',
          orderId: ctx.orderId,
          terminalId: ctx.terminalId || undefined,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // ── Socket event: drawer:opened (fire-and-forget) ──
    void emitDrawerOpenedEvent(ctx.order.locationId, ctx.employeeId, 'cash_payment', ctx.terminalId ?? undefined).catch(err =>
      log.warn({ err }, 'drawer:opened socket emission failed')
    )
  }

  void (async () => {
    const localDrawer = await resolveDrawerForPayment('cash', ctx.employeeId || null, ctx.terminalId ?? undefined)
    if (localDrawer.drawerId && ctx.employeeId) {
      try {
        const ownerShift = await db.shift.findFirst({
          where: {
            drawerId: localDrawer.drawerId!,
            status: 'open',
            deletedAt: null,
          },
          select: { id: true, employeeId: true },
        })
        if (ownerShift && ownerShift.employeeId !== ctx.employeeId) {
          void db.auditLog.create({
            data: {
              locationId: ctx.order.locationId,
              employeeId: ctx.employeeId,
              action: 'manager_drawer_access',
              entityType: 'drawer',
              entityId: localDrawer.drawerId!,
              details: {
                shiftOwnerEmployeeId: ownerShift.employeeId,
                shiftId: ownerShift.id,
                orderId: ctx.orderId,
                reason: 'Payment processed by different employee',
              },
            },
          }).catch(err => log.warn({ err }, 'Background task failed'))
        }
      } catch (caughtErr) {
        console.error('[Pay] Manager drawer access audit failed:', caughtErr)
      }
    }
  })()
}

// ─── Tip Allocation ─────────────────────────────────────────────────────

export function allocateTips(ctx: PostPaymentContext): void {
  if (ctx.totalTips <= 0 || ctx.isTrainingPayment) return

  let tipOwnerEmployeeId = ctx.order.employeeId || ctx.employeeId

  if (ctx.order.orderType === 'delivery') {
    // Delivery tip allocation
    void (async () => {
      try {
        const deliveryOrders = await db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "DeliveryOrder"
           WHERE "orderId" = ${ctx.orderId} AND "locationId" = ${ctx.order.locationId} AND "deletedAt" IS NULL
           LIMIT 1
        `
        if (deliveryOrders.length) {
          const resolved = await resolveDeliveryTipRecipient(
            ctx.order.locationId,
            deliveryOrders[0].id,
          )
          tipOwnerEmployeeId = resolved.recipientId
        }
      } catch (caughtErr) {
        console.error('[Pay] Delivery tip recipient resolution failed, using default:', caughtErr)
      }

      if (tipOwnerEmployeeId) {
        await allocateTipsPerPayment(ctx, tipOwnerEmployeeId)
      }
    })()
  } else if ((ctx.order as any).orderTypeRef?.allowTips !== false) {
    if (tipOwnerEmployeeId) {
      void allocateTipsPerPayment(ctx, tipOwnerEmployeeId)
    } else {
      console.warn(`[pay] Tip of $${ctx.totalTips.toFixed(2)} on order ${ctx.orderId} has no employee to allocate to`)
      void db.auditLog.create({
        data: {
          locationId: ctx.order.locationId,
          action: 'unallocated_tip',
          entityType: 'order',
          entityId: ctx.orderId,
          details: {
            totalTips: ctx.totalTips,
            paymentIds: ctx.ingestResult.bridgedPayments.map((bp: { id: string }) => bp.id),
            reason: 'No employeeId on order or payment request',
          },
        },
      }).catch(err => {
        console.error('[pay] Failed to create audit log for unallocated tip:', err)
      })
    }
  }
}

async function allocateTipsPerPayment(ctx: PostPaymentContext, tipOwnerEmployeeId: string): Promise<void> {
  for (const bp of ctx.ingestResult.bridgedPayments) {
    const paymentTip = Number(bp.tipAmount) || 0
    if (paymentTip <= 0) continue

    const tipAllocParams = {
      locationId: ctx.order.locationId,
      orderId: ctx.orderId,
      primaryEmployeeId: tipOwnerEmployeeId,
      createdPayments: [{
        id: bp.id,
        paymentMethod: bp.paymentMethod,
        tipAmount: bp.tipAmount,
      }],
      totalTipsDollars: paymentTip,
      tipBankSettings: ctx.settings.tipBank,
      kind: ctx.autoGratApplied ? 'auto_gratuity' : 'tip',
    }
    try {
      await allocateTipsForPayment(tipAllocParams)
    } catch (tipErr) {
      console.error('[PAYMENT-SAFETY] Tip allocation failed -- creating recovery record', {
        orderId: ctx.orderId, paymentId: bp.id, tipAmount: paymentTip,
        error: tipErr instanceof Error ? tipErr.message : String(tipErr),
      })
      try {
        await db.auditLog.create({
          data: {
            locationId: ctx.order.locationId,
            action: 'tip_allocation_failed',
            entityType: 'order',
            entityId: ctx.orderId,
            details: {
              flow: ctx.order.orderType === 'delivery' ? 'pay-delivery' : 'pay',
              tipAmount: paymentTip,
              primaryEmployeeId: tipOwnerEmployeeId,
              paymentId: bp.id,
              paymentMethod: bp.paymentMethod,
              kind: ctx.autoGratApplied ? 'auto_gratuity' : 'tip',
              error: tipErr instanceof Error ? tipErr.message : String(tipErr),
              retryParams: tipAllocParams,
            },
          },
        })
      } catch (auditErr) {
        console.error('[PAYMENT-SAFETY] CRITICAL: Both tip allocation AND recovery record failed', {
          orderId: ctx.orderId, locationId: ctx.order.locationId, tipAmount: paymentTip,
          employeeId: tipOwnerEmployeeId, paymentId: bp.id,
          tipError: tipErr instanceof Error ? tipErr.message : String(tipErr),
          auditError: auditErr instanceof Error ? auditErr.message : String(auditErr),
        })
      }
    }
  }
}

// ─── Table Release ──────────────────────────────────────────────────────

export function releaseTableIfEmpty(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid || !ctx.order.tableId) return

  void (async () => {
    try {
      // eslint-disable-next-line no-restricted-syntax
      const otherOpenOrders = await db.order.count({
        where: {
          tableId: ctx.order.tableId!,
          locationId: ctx.order.locationId,
          id: { not: ctx.order.id },
          status: { in: ['open', 'sent', 'in_progress', 'draft', 'split'] },
          deletedAt: null,
        },
      })
      if (otherOpenOrders === 0) {
        await db.table.update({
          where: { id: ctx.order.tableId! },
          data: { status: 'available' },
        })
        invalidateSnapshotCache(ctx.order.locationId)
        void dispatchTableStatusChanged(ctx.order.locationId, { tableId: ctx.order.tableId!, status: 'available' }).catch(err => log.warn({ err }, 'Background task failed'))
      }
    } catch (caughtErr) {
      console.error('[Pay] Table status reset failed:', caughtErr)
    }
  })()

  // Clean up temporary seats then dispatch floor plan update
  void cleanupTemporarySeats(ctx.orderId)
    .then(() => {
      if (ctx.order.tableId && ctx.orderIsPaid) {
        return dispatchFloorPlanUpdate(ctx.order.locationId, { async: true })
      }
    })
    .catch(err => log.warn({ err }, 'Background task failed'))
}

// ─── Socket Event Dispatches ────────────────────────────────────────────

export function dispatchPaymentSocketEvents(ctx: PostPaymentContext): void {
  // Dispatch real-time order totals update (tip changed)
  if (ctx.totalTips > 0) {
    void dispatchOrderTotalsUpdate(ctx.order.locationId, ctx.orderId, {
      subtotal: toNumber(ctx.order.subtotal ?? 0),
      taxTotal: toNumber(ctx.order.taxTotal ?? 0),
      tipTotal: ctx.newTipTotal,
      discountTotal: toNumber(ctx.order.discountTotal ?? 0),
      total: toNumber(ctx.order.total ?? 0),
    }, { async: true }).catch(err => {
      console.error('Failed to dispatch order totals update:', err)
    })
  }

  // Dispatch payment:processed for each created payment
  for (const p of ctx.ingestResult.bridgedPayments) {
    void dispatchPaymentProcessed(ctx.order.locationId, {
      orderId: ctx.orderId,
      paymentId: p.id,
      status: 'completed',
      sourceTerminalId: ctx.terminalId || undefined,
      method: p.paymentMethod,
      amount: p.amount,
      tipAmount: p.tipAmount || 0,
      totalAmount: p.totalAmount,
      employeeId: ctx.employeeId || null,
      isClosed: ctx.orderIsPaid,
      cardBrand: p.cardBrand || null,
      cardLast4: p.cardLast4 || null,
      parentOrderId: ctx.order.parentOrderId || null,
      allSiblingsPaid: false, // Overridden by dispatchSplitParentEvents if needed
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
  }

  // Dispatch gift card balance changes
  for (const gc of ctx.giftCardBalanceChanges) {
    void dispatchGiftCardBalanceChanged(ctx.order.locationId, gc).catch(err => log.warn({ err }, 'gift card balance dispatch failed'))
  }

  // Release order claim after successful payment
  if (ctx.orderIsPaid) {
    void db.$executeRaw`
      UPDATE "Order" SET "claimedByEmployeeId" = NULL, "claimedByTerminalId" = NULL, "claimedAt" = NULL WHERE id = ${ctx.orderId}
    `.catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
  }

  // Dispatch open orders list changed + order closed
  if (ctx.orderIsPaid) {
    void dispatchOpenOrdersChanged(ctx.order.locationId, { trigger: 'paid', orderId: ctx.order.id, tableId: ctx.order.tableId || undefined, sourceTerminalId: ctx.terminalId || undefined }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))
    void dispatchOrderClosed(ctx.order.locationId, {
      orderId: ctx.order.id,
      status: 'paid',
      closedAt: new Date().toISOString(),
      closedByEmployeeId: ctx.employeeId || null,
      locationId: ctx.order.locationId,
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
  }
}

// ─── Notification Pager Release ─────────────────────────────────────────

export function releaseNotificationAssignments(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid) return

  void (async () => {
    try {
      const { releaseAssignmentsForSubject } = await import('@/lib/notifications/release-assignments')
      await releaseAssignmentsForSubject(ctx.order.locationId, 'order', ctx.order.id, 'order_paid', ctx.employeeId || undefined)
    } catch (releaseErr) {
      console.warn('[Pay] Failed to release notification assignments:', releaseErr)
    }
  })()
}

// ─── CFD Receipt ────────────────────────────────────────────────────────

export function dispatchCFDReceipt(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid) return

  dispatchCFDReceiptSent(ctx.order.locationId, null, {
    orderId: ctx.order.id,
    total: toNumber(ctx.order.total ?? 0),
  })
}

// ─── Cloud Event ────────────────────────────────────────────────────────

export function emitOrderPaidCloudEvent(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid) return

  void emitCloudEvent('order_paid', {
    orderId: ctx.order.id,
    orderNumber: ctx.order.orderNumber,
    venueId: ctx.order.locationId,
    employeeId: ctx.order.employeeId,
    customerId: ctx.order.customerId,
    orderType: ctx.order.orderType,
    paidAt: new Date(),
    subtotal: toNumber(ctx.order.subtotal ?? 0),
    taxTotal: toNumber(ctx.order.taxTotal ?? 0),
    tipTotal: ctx.newTipTotal,
    discountTotal: toNumber(ctx.order.discountTotal ?? 0),
    total: toNumber(ctx.order.total ?? 0),
    payments: ctx.ingestResult.bridgedPayments.map((p: any) => ({
      id: p.id,
      method: p.paymentMethod,
      amount: p.amount,
      tipAmount: p.tipAmount,
      totalAmount: p.totalAmount,
      cardLast4: p.cardLast4 ?? null,
    })),
  }).catch(err => log.warn({ err }, 'Background task failed'))
}

// ─── Auto Email Receipt for Online Orders ───────────────────────────────

export function sendAutoEmailReceipt(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid) return
  if (!ctx.order.orderType || !['online', 'pickup', 'delivery'].includes(ctx.order.orderType)) return

  const customerEmail = (ctx.order.customer as any)?.email
  if (!customerEmail) return

  void fetch(`${process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`}/api/receipts/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: ctx.order.id,
      email: customerEmail,
      locationId: ctx.order.locationId,
    }),
  }).catch(err => console.error('[Pay] Auto email receipt for online order failed:', err))
}

// ─── Cake Settlement Hook ───────────────────────────────────────────────

export function handleCakeSettlement(ctx: PostPaymentContext): void {
  if (!ctx.orderIsPaid) return
  if (!ctx.order.orderType) return

  void (async () => {
    const { CAKE_SETTLEMENT_TYPES } = await import('@/lib/cake-orders/schemas')
    if (!CAKE_SETTLEMENT_TYPES.includes(ctx.order.orderType as any)) return

    try {
      const { handleCakeSettlementCompletion } = await import('@/lib/cake-orders/cake-payment-service')
      await handleCakeSettlementCompletion(db, {
        orderId: ctx.order.id,
        paymentId: ctx.ingestResult.bridgedPayments[0]?.id || '',
        locationId: ctx.order.locationId,
        employeeId: ctx.order.employeeId || '',
      })
    } catch (caughtErr) {
      console.error('[Pay] Cake settlement completion hook failed:', caughtErr)
    }
  })()
}

// ─── Card Recognition ───────────────────────────────────────────────────

export function detectCardRecognition(ctx: PostPaymentContext): void {
  if (ctx.order.customer?.id || !ctx.settings.tabs?.cardRecognitionEnabled) return

  void (async () => {
    try {
      const cardPayment = ctx.ingestResult.bridgedPayments.find(
        (p: any) => (p.paymentMethod === 'credit' || p.paymentMethod === 'debit') && p.cardLast4
      )
      if (!cardPayment) return
      const matchedProfile = await db.cardProfile.findFirst({
        where: {
          locationId: ctx.order.locationId,
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
      const { emitToLocation } = await import('@/lib/socket-server')
      await emitToLocation(ctx.order.locationId, 'payment:card-recognized', {
        orderId: ctx.orderId,
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

// ─── Orchestrator ───────────────────────────────────────────────────────

/**
 * Run ALL post-payment side effects.
 * Each effect is independently resilient (fire-and-forget or try/catch).
 * Order of execution matters for a few (e.g., split closure before socket events).
 */
export async function runPostPaymentEffects(
  ctx: PostPaymentContext,
  updateData: any,
): Promise<{ parentWasMarkedPaid: boolean; parentTableId: string | null }> {
  // R3: Total drift detection
  detectTotalDrift(ctx)

  // Outage queue writes
  handleOutageQueueWrites(ctx)

  // Auto-send unsent items to kitchen
  autoSendUnsentItems(ctx)

  // Complete PMS attempt
  completePmsAttempt(ctx)

  // Split family closure (awaited because later effects need the result)
  const { parentWasMarkedPaid, parentTableId } = await handleSplitFamilyClosure(ctx)

  // Customer stats + loyalty (fire-and-forget)
  updateCustomerStatsAndLoyalty(ctx)

  // Audit logs
  createPaymentAuditLogs(ctx)

  // Post-payment order update (awaited -- critical for reports)
  await updateOrderPostPayment(ctx, updateData)

  // Split parent socket events
  dispatchSplitParentEvents(ctx, parentWasMarkedPaid, parentTableId)

  // Entertainment reset
  resetEntertainmentItems(ctx)

  // Inventory deduction
  createInventoryDeduction(ctx)

  // Commission recalculation
  recalculateCommissions(ctx)

  // Cash drawer
  handleCashDrawer(ctx)

  // Tip allocation
  allocateTips(ctx)

  // Table release
  releaseTableIfEmpty(ctx)

  // Socket events
  dispatchPaymentSocketEvents(ctx)

  // Notification pager release
  releaseNotificationAssignments(ctx)

  // CFD receipt
  dispatchCFDReceipt(ctx)

  // Cloud event
  emitOrderPaidCloudEvent(ctx)

  // Auto email receipt
  sendAutoEmailReceipt(ctx)

  // Cake settlement
  handleCakeSettlement(ctx)

  // Upstream sync
  pushUpstream()

  // Card recognition
  detectCardRecognition(ctx)

  return { parentWasMarkedPaid, parentTableId }
}
