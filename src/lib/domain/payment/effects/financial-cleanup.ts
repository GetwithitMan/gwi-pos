/**
 * Financial Cleanup Effects
 *
 * - PMS attempt finalization
 * - Split family closure
 * - Post-payment order update (businessDayDate, tipTotal, version)
 * - Inventory deduction outbox
 * - Commission recalculation
 * - Cash drawer kick + audit
 * - Tip allocation
 */
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { errorCapture } from '@/lib/error-capture'
import { roundToCents, toNumber } from '@/lib/pricing'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { resolveDeliveryTipRecipient } from '@/lib/delivery/tip-reallocation'
import { triggerCashDrawer } from '@/lib/cash-drawer'
import { deductPrepStockForOrder } from '@/lib/inventory-calculations'
import { resolveDrawerForPayment } from '@/lib/domain/payment'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('payment-effects-financial')

// ─── 4. PMS Attempt Finalization ─────────────────────────────────────────────

export function finalizePmsAttempt(
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

// ─── 5. Split Family Closure ─────────────────────────────────────────────────

export async function handleSplitFamilyClosure(
  order: any,
  orderId: string,
  orderIsPaid: boolean,
  isSplitPayRemaining: boolean,
): Promise<{ parentWasMarkedPaid: boolean; parentTableId: string | null }> {
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
  return { parentWasMarkedPaid, parentTableId }
}

// ─── 8. Post-Payment Order Update ────────────────────────────────────────────

export async function runPostPaymentOrderUpdate(
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

// ─── 10. Inventory Deduction Outbox ──────────────────────────────────────────

export async function createInventoryDeductionOutbox(
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

export function recalculateCommission(
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

export function kickCashDrawerAndAudit(
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

export async function allocateTips(
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
