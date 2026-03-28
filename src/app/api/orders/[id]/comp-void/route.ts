import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as OrderItemRepository from '@/lib/repositories/order-item-repository'
import * as PaymentRepository from '@/lib/repositories/payment-repository'
import { deductInventoryForVoidedItem, restorePrepStockForVoid, restoreInventoryForRestoredItem, WASTE_VOID_REASONS } from '@/lib/inventory-calculations'
import { requirePermission } from '@/lib/api-auth'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { PERMISSIONS } from '@/lib/auth-utils'
import { roundToCents, calculateCardPrice } from '@/lib/pricing'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate, dispatchFloorPlanUpdate, dispatchOrderSummaryUpdated, dispatchOrderClosed, dispatchTabItemsUpdated, dispatchEntertainmentStatusChanged, dispatchCFDOrderUpdated, dispatchTableStatusChanged } from '@/lib/socket-dispatch'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { emitCloudEvent } from '@/lib/cloud-events'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { checkOrderClaim } from '@/lib/order-claim'
import { isClosed } from '@/lib/domain/order-status'
import { getRequestLocationId } from '@/lib/request-context'
import { validateManagerReauthFromHeaders, validateCellularOrderAccess, CellularAuthError } from '@/lib/cellular-validation'
import {
  calculateItemTotal,
  isEmployeeMealReason,
  validateOrderForCompVoid,
  validateVersion,
  validateItemForCompVoid,
  validateSentItemVoid,
  validateItemForRestore,
  validateVoidApproval,
  validateVoid2FA,
  validateSplitParent,
  validateRemoteApproval,
  validateReasonPreset,
  applyCompVoid,
  applyRestore,
} from '@/lib/domain/comp-void'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('orders-comp-void')

interface CompVoidRequest {
  action: 'comp' | 'void'
  itemId: string
  reason: string
  employeeId: string
  wasMade?: boolean  // Was the item already made? Determines waste tracking
  approvedById?: string  // Manager ID if approval required
  managerPinHash?: string  // Manager PIN hash for cellular re-auth
  remoteApprovalCode?: string  // 6-digit code from remote manager approval (Skill 121)
  version?: number  // Optimistic concurrency control
}

// POST - Comp or void an item
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id: orderId } = await ctx.params
    const body = await request.json() as CompVoidRequest

    const { action, itemId, reason, wasMade, approvedById, managerPinHash, remoteApprovalCode, version } = body
    // SECURITY: Use authenticated employee ID for the performer, not body.employeeId.
    // body.employeeId is accepted as a fallback for cellular terminals (which may have
    // employeeId in the token but also send it in body for legacy compatibility).
    const employeeId = ctx.auth.employeeId || body.employeeId

    if (!action || !itemId || !reason || !employeeId) {
      return NextResponse.json(
        { error: 'Action, item ID, reason, and employee ID are required' },
        { status: 400 }
      )
    }

    // Cellular terminal: require manager PIN re-authentication for comp/void
    // (only when approvedById is provided and not using remote approval)
    if (approvedById && !remoteApprovalCode) {
      try {
        validateManagerReauthFromHeaders(request, approvedById, managerPinHash)
      } catch (err) {
        if (err instanceof CellularAuthError) {
          return NextResponse.json({ error: err.message }, { status: err.status })
        }
        throw err
      }
    }

    // Cellular ownership gating — block comp/void on locally-owned orders
    const isCellularCompVoid = request.headers.get('x-cellular-authenticated') === '1'
    if (isCellularCompVoid) {
      try {
        await validateCellularOrderAccess(true, orderId, 'mutate', db)
      } catch (err) {
        if (err instanceof CellularAuthError) {
          return NextResponse.json({ error: err.message }, { status: err.status })
        }
        throw err
      }
    }

    // Order claim check — block if another employee has an active claim
    const terminalId = request.headers.get('x-terminal-id')
    const claimBlock = await checkOrderClaim(db, orderId, employeeId, terminalId)
    if (claimBlock) {
      return NextResponse.json(
        { error: claimBlock.error, claimedBy: claimBlock.claimedBy },
        { status: claimBlock.status }
      )
    }

    // If remote approval code is provided, validate it
    const { approval: remoteApproval, error: approvalError } = await validateRemoteApproval(
      db as any, remoteApprovalCode, orderId, itemId,
    )
    if (approvalError) {
      return NextResponse.json({ error: approvalError.error }, { status: approvalError.status })
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let compVoidLocationId = getRequestLocationId()
    if (!compVoidLocationId) {
      const compVoidLocationCheck = await db.order.findFirst({
        where: { id: orderId },
        select: { locationId: true },
      })
      if (!compVoidLocationCheck) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }
      compVoidLocationId = compVoidLocationCheck.locationId
    }

    const order = await OrderRepository.getOrderByIdWithInclude(orderId, compVoidLocationId, {
      location: true,
      payments: {
        where: { deletedAt: null },
        select: { id: true, status: true },
      },
      items: {
        where: { id: itemId },
        include: {
          modifiers: true,
          menuItem: { select: { id: true, itemType: true, name: true } },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Validate order state
    const orderError = validateOrderForCompVoid(order)
    if (orderError) {
      return NextResponse.json({ error: orderError.error }, { status: orderError.status })
    }

    // Concurrency check
    const versionError = validateVersion(order.version, version)
    if (versionError) {
      return NextResponse.json({
        error: versionError.error,
        conflict: true,
        currentVersion: order.version,
      }, { status: versionError.status })
    }

    // Server-side permission check: requesting employee needs basic POS access
    // Actual void/comp authorization comes from approvedById or remote approval code
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Validate approvedById has manager void permission if provided
    if (approvedById && !remoteApprovalCode) {
      const approverAuth = await requirePermission(approvedById, order.locationId, PERMISSIONS.MGR_VOID_ITEMS)
      if (!approverAuth.authorized) {
        return NextResponse.json(
          { error: 'You do not have permission to perform this action' },
          { status: 403 }
        )
      }

      // V3 FRAUD FIX: Prevent self-approval — requester cannot approve their own void/comp.
      // Exception: managers (who have MGR_VOID_ITEMS) can self-approve items below the approval threshold.
      // The threshold check is deferred until after item total is calculated (see V3 deferred check below).
      // Since we reach here only if approvedById passed the MGR_VOID_ITEMS check above,
      // and approvedById === employeeId means the employee IS a manager — so we only defer.
      // Non-managers can never self-approve because they'd fail the approverAuth check above.
    }

    // Validate reason against allowed presets (backward compatible)
    const reasonError = await validateReasonPreset(db as any, action, reason, order.locationId, employeeId)
    if (reasonError) {
      return NextResponse.json({ error: reasonError.error }, { status: reasonError.status })
    }

    // W4-1: Enforce configurable void approval from location settings
    const settings = parseSettings(order.location.settings)

    const item = order.items[0]

    // C1: Double-void/comp idempotency — if item is already voided or comped, return 200
    // (idempotent success) instead of 400 error. This prevents double tip allocation reversal
    // and other side effects from re-processing an already-completed action.
    if (item && (item.status === 'voided' || item.status === 'comped')) {
      return NextResponse.json({ data: { alreadyProcessed: true, message: `Item already ${item.status}` } })
    }

    const itemError = validateItemForCompVoid(item)
    if (itemError) {
      return NextResponse.json({ error: itemError.error }, { status: itemError.status })
    }

    // Calculate the item total (price + modifiers) * quantity
    const itemTotal = calculateItemTotal(item!.price, item!.modifiers, item!.quantity)

    // V3 FRAUD FIX (deferred check): Managers self-approving must be below the threshold
    if (approvedById && approvedById === employeeId && !remoteApprovalCode) {
      const { exceedsThreshold } = await import('@/lib/domain/comp-void/calculations')
      const isAboveThreshold = exceedsThreshold(itemTotal, settings.approvals.voidApprovalThreshold)
      if (isAboveThreshold) {
        return NextResponse.json(
          { error: 'Cannot approve your own void/comp for items at or above the approval threshold. A different manager must approve.' },
          { status: 403 }
        )
      }
    }

    // V1 FRAUD FIX: Enforce manager approval + wasMade=true for items already sent to kitchen
    let effectiveWasMade = wasMade
    const sentItemCheck = validateSentItemVoid(
      item! as any, // OrderItem has kitchenStatus and kitchenSentAt fields
      !!approvedById,
      !!remoteApprovalCode,
      wasMade,
    )
    if (sentItemCheck.error) {
      return NextResponse.json(
        { error: sentItemCheck.error.error, requiresApproval: sentItemCheck.error.requiresApproval },
        { status: sentItemCheck.error.status }
      )
    }
    if (sentItemCheck.wasMadeDefault) {
      // Item was sent to kitchen and wasMade not explicitly provided — default to true for inventory tracking
      effectiveWasMade = true
    }

    // Approval + 2FA checks apply to BOTH comp and void — never let either bypass manager approval
    const compVoidApprovalError = validateVoidApproval(
      itemTotal, settings.approvals, !!approvedById, !!remoteApprovalCode,
    )
    if (compVoidApprovalError) {
      return NextResponse.json(
        { error: compVoidApprovalError.error, requiresApproval: compVoidApprovalError.requiresApproval },
        { status: compVoidApprovalError.status }
      )
    }

    // W5-11: 2FA enforcement for large comps/voids
    const twoFAError = validateVoid2FA(itemTotal, settings.security, !!remoteApprovalCode)
    if (twoFAError) {
      return NextResponse.json(
        { error: twoFAError.error, requiresRemoteApproval: twoFAError.requiresRemoteApproval },
        { status: twoFAError.status }
      )
    }

    // Guard: cannot void/cancel a split parent with unpaid children
    const splitError = await validateSplitParent(db as any, order)
    if (splitError) {
      return NextResponse.json({ error: splitError.error }, { status: splitError.status })
    }

    // Determine the approving manager (from remote approval or direct)
    const effectiveApprovedById = remoteApproval?.manager.id || approvedById || null
    const effectiveApprovedAt = remoteApproval?.approvedAt || (approvedById ? new Date() : null)

    const newStatus = action === 'comp' ? 'comped' : 'voided'

    // Wrap all critical writes in a single transaction
    const { activeItemCount, totals, shouldAutoClose, parentTotals, cardPayments, voidLogId } = await db.$transaction(async (tx) => {
      return applyCompVoid(tx, {
        orderId,
        itemId,
        action,
        reason,
        employeeId,
        wasMade: effectiveWasMade,
        approvedById: effectiveApprovedById,
        approvedAt: effectiveApprovedAt,
        remoteApprovalId: remoteApproval?.id || null,
        locationId: order.locationId,
        itemName: item!.name,
        itemQuantity: item!.quantity,
        itemTotal,
        isBottleService: order.isBottleService,
        mutationOrigin: isCellularCompVoid ? 'cloud' : 'local',
      }, order.location.settings as { tax?: { defaultRate?: number } })
    })

    // ── Outage queue protection for VoidLog ────────────────────────────────
    try {
      await queueIfOutageOrFail('VoidLog', order.locationId, voidLogId, 'INSERT')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return NextResponse.json({ error: 'Service temporarily unavailable — outage queue full' }, { status: 507 })
      }
      throw err
    }

    // V4 FRAUD FIX: Consume remote approval code AFTER successful void (prevents reuse)
    if (remoteApproval) {
      void db.remoteVoidApproval.update({
        where: { id: remoteApproval.id },
        data: { status: 'used', usedAt: new Date() },
      }).catch(err => {
        // Non-fatal: log but don't fail the void — the void already succeeded
        console.error('[CompVoid] Failed to mark remote approval as used:', err)
      })
    }

    // W1-P1: Attempt Datacap reversal for card payments (outside transaction)
    let cardReversalWarning: string | null = null
    if (cardPayments.length > 0) {
      const reversiblePayments = cardPayments.filter(
        (p) => ['credit', 'debit'].includes(p.paymentMethod) && p.datacapRecordNo && p.paymentReaderId
      )
      if (reversiblePayments.length > 0) {
        try {
          const datacapClient = await getDatacapClient(order.locationId)
              // H-FIN-6: Cap total refund at the sum of refundable amounts across all payments
          // to prevent refunding more than was originally paid
          const totalRefundable = reversiblePayments.reduce(
            (sum, p) => sum + Math.max(0, Number(p.totalAmount) - Number(p.refundedAmount ?? 0)), 0
          )
          // Dual pricing fix: when the customer was charged the card price (credit/debit with dual
          // pricing enabled), the refund must use the card price — not the stored cash price.
          const dualPricing = settings.dualPricing
          const cashDiscountPercent = dualPricing.cashDiscountPercent || 4.0
          const allReversibleAreCard = reversiblePayments.every(
            (p) => ['credit', 'debit'].includes(p.paymentMethod)
          )
          const appliesForCard = dualPricing.enabled && (
            (dualPricing.applyToCredit && reversiblePayments.some((p) => p.paymentMethod === 'credit')) ||
            (dualPricing.applyToDebit  && reversiblePayments.some((p) => p.paymentMethod === 'debit'))
          )
          const refundBase = (allReversibleAreCard && appliesForCard)
            ? calculateCardPrice(itemTotal, cashDiscountPercent)
            : itemTotal
          let remainingRefund = Math.min(refundBase, totalRefundable)
          for (const payment of reversiblePayments) {
            try {
              if (shouldAutoClose) {
                // All items voided — reverse the payment
                const alreadyRefunded = Number(payment.refundedAmount ?? 0)

                if (alreadyRefunded > 0) {
                  // C-FIN-2: Prior partial refund exists — cannot voidSale (would double-refund).
                  // Issue a return for only the remaining non-refunded amount instead.
                  const remainingToRefund = Number(payment.totalAmount) - alreadyRefunded
                  if (remainingToRefund > 0) {
                    const result = await datacapClient.emvReturn(payment.paymentReaderId!, {
                      amount: remainingToRefund,
                      recordNo: payment.datacapRecordNo!,
                      cardPresent: false,
                      invoiceNo: orderId,
                    })
                    if (result.cmdStatus === 'Approved' || result.cmdStatus === 'Success') {
                      await PaymentRepository.updatePayment(payment.id, order.locationId, {
                        status: 'voided', refundedAmount: payment.totalAmount, refundedAt: new Date(),
                      })
                      console.log(`[CompVoid] Datacap remaining refund of $${remainingToRefund.toFixed(2)} succeeded for payment ${payment.id} (card ***${payment.cardLast4})`)
                    } else {
                      cardReversalWarning = `Card refund declined for ***${payment.cardLast4}: ${result.textResponse}. Manual refund may be required.`
                      console.warn(`[CompVoid] Datacap remaining refund declined for payment ${payment.id}: ${result.textResponse}`)
                    }
                  } else {
                    // Already fully refunded via previous partial refunds — just mark voided
                    await PaymentRepository.updatePayment(payment.id, order.locationId, { status: 'voided' })
                    console.log(`[CompVoid] Payment ${payment.id} already fully refunded, marked voided`)
                  }
                } else {
                  // No previous refunds — safe to void the entire sale
                  const result = await datacapClient.voidSale(payment.paymentReaderId!, { recordNo: payment.datacapRecordNo! })
                  if (result.cmdStatus === 'Approved' || result.cmdStatus === 'Success') {
                    await PaymentRepository.updatePayment(payment.id, order.locationId, { status: 'voided' })
                    console.log(`[CompVoid] Datacap void succeeded for payment ${payment.id} (card ***${payment.cardLast4})`)
                  } else {
                    cardReversalWarning = `Card reversal declined for ***${payment.cardLast4}: ${result.textResponse}. Manual refund may be required.`
                    console.warn(`[CompVoid] Datacap void declined for payment ${payment.id}: ${result.textResponse}`)
                  }
                }
              } else {
                // Partial void — refund the voided item amount, split across payments
                if (remainingRefund <= 0) break
                const alreadyRefunded = Number(payment.refundedAmount ?? 0)
                const paymentAvailable = Number(payment.totalAmount) - alreadyRefunded
                const refundAmount = Math.min(remainingRefund, paymentAvailable)
                if (refundAmount <= 0) continue

                const result = await datacapClient.emvReturn(payment.paymentReaderId!, {
                  amount: refundAmount,
                  recordNo: payment.datacapRecordNo!,
                  cardPresent: false,
                  invoiceNo: orderId,
                })
                if (result.cmdStatus === 'Approved' || result.cmdStatus === 'Success') {
                  await PaymentRepository.updatePayment(payment.id, order.locationId, {
                    refundedAmount: { increment: refundAmount }, refundedAt: new Date(),
                  })
                  remainingRefund -= refundAmount
                  console.log(`[CompVoid] Datacap partial refund of $${refundAmount.toFixed(2)} succeeded for payment ${payment.id}`)
                } else {
                  cardReversalWarning = `Card refund declined for ***${payment.cardLast4}: ${result.textResponse}. Manual refund may be required.`
                  console.warn(`[CompVoid] Datacap partial refund declined for payment ${payment.id}: ${result.textResponse}`)
                }
              }
            } catch (reversalErr) {
              const msg = reversalErr instanceof Error ? reversalErr.message : 'Unknown error'
              cardReversalWarning = `Card reversal error for ***${payment.cardLast4}: ${msg}. DB void completed but manual refund may be required.`
              console.error(`[CompVoid] Datacap reversal failed for payment ${payment.id}:`, reversalErr)
            }
          }
        } catch (clientErr) {
          cardReversalWarning = `Could not initialize payment processor: ${clientErr instanceof Error ? clientErr.message : 'Unknown error'}. Manual card refund may be required.`
          console.error('[CompVoid] Failed to create Datacap client:', clientErr)
        }
      }
    }

    // Emit order event for comp/void (fire-and-forget)
    void emitOrderEvent(order.locationId, orderId, 'COMP_VOID_APPLIED', {
      lineItemId: itemId,
      action,
      reason: reason || null,
      employeeId,
      approvedById: effectiveApprovedById || null,
    })

    // W1-K1: Dispatch KDS event so voided items disappear from KDS screens
    void emitToLocation(order.locationId, 'kds:item-status', {
      orderId,
      itemId,
      status: newStatus,
    }).catch(err => {
      console.error('[CompVoid] Failed to dispatch KDS void event:', err)
    })

    // Fire-and-forget: Track employee meal if comp reason is employee_meal
    if (action === 'comp') {
      if (isEmployeeMealReason(reason) && settings.employeeMeals?.enabled) {
        void db.auditLog.create({
          data: {
            locationId: order.locationId,
            employeeId,
            action: 'employee_meal',
            entityType: 'order',
            entityId: orderId,
            details: {
              itemId,
              itemName: item!.name,
              amount: itemTotal,
              source: 'comp_void',
              approvedBy: effectiveApprovedById || null,
            },
          },
        }).catch(err => {
          console.error('[CompVoid] Failed to log employee meal tracking:', err)
        })
      }
    }

    // Fire-and-forget side effects OUTSIDE the transaction

    // BUG #378: Reset entertainment status when voiding a timed_rental item
    // Only void — comp means customer plays for free but is still using the item
    // TODO: migrate to MenuItemRepository/FloorPlanElementRepository once those repos exist
    if (action === 'void' && item!.menuItem?.itemType === 'timed_rental') {
      void db.menuItem.update({
        where: { id: item!.menuItem.id },
        data: {
          entertainmentStatus: 'available',
          currentOrderId: null,
          currentOrderItemId: null,
        },
      }).then(() => {
        // Also reset the floor plan element linked to this menu item
        return db.floorPlanElement.updateMany({
          where: { linkedMenuItemId: item!.menuItem!.id, deletedAt: null },
          data: {
            status: 'available',
            currentOrderId: null,
            sessionStartedAt: null,
            sessionExpiresAt: null,
          },
        })
      }).then(() => {
        return dispatchFloorPlanUpdate(order.locationId, { async: true })
      }).catch(err => {
        console.error('[CompVoid] Failed to reset entertainment status:', err)
      })

      void dispatchEntertainmentStatusChanged(order.locationId, {
        itemId: item!.menuItem!.id,
        entertainmentStatus: 'available',
        currentOrderId: null,
        expiresAt: null,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.comp-void'))

      void notifyNextWaitlistEntry(order.locationId, item!.menuItem.id, item!.menuItem.name).catch(err => log.warn({ err }, 'waitlist notify failed'))
    }

    // Deduct inventory for voids where food was made
    const normalizedReason = reason.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
    const normalizedWasteReasons = WASTE_VOID_REASONS.map(r => r.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_'))
    const shouldDeductInventory = action === 'comp'
      || (effectiveWasMade !== undefined ? effectiveWasMade : normalizedWasteReasons.includes(normalizedReason))

    if (shouldDeductInventory) {
      const deductionType = action === 'comp' ? 'comp' as const : 'waste' as const
      deductInventoryForVoidedItem(itemId, reason, employeeId, undefined, deductionType).catch(err => {
        console.error('Background waste inventory deduction failed:', err)
      })
    } else {
      restorePrepStockForVoid(orderId, [itemId], false).catch(err => {
        console.error('Background prep stock restoration failed:', err)
      })
    }

    // Clean up temporary seats if order auto-closed, then refresh floor plan
    if (shouldAutoClose) {
      // C12: Release the table when all items are voided/comped (prevent zombie tables)
      // TODO: Add TableRepository once that repository exists
      if (order.tableId) {
        await db.table.update({ where: { id: order.tableId }, data: { status: 'available' } })
        void dispatchTableStatusChanged(order.locationId, { tableId: order.tableId, status: 'available' }).catch(err => log.warn({ err }, 'Background task failed'))
        void dispatchFloorPlanUpdate(order.locationId).catch(err => log.warn({ err }, 'Background task failed'))
      }

      void cleanupTemporarySeats(orderId)
        .then(() => {
          if (order.tableId) {
            return dispatchFloorPlanUpdate(order.locationId, { async: true })
          }
        })
        .catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Emit cloud event for void/comp (fire-and-forget)
    void emitCloudEvent("order_voided", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      employeeId,
      voidType: action,
      reason: reason || null,
      amount: itemTotal,
      items: [{
        id: item!.id,
        name: item!.name,
        quantity: item!.quantity,
        price: Number(item!.price),
      }],
    }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'item_updated',
      orderId,
      status: shouldAutoClose ? 'cancelled' : order.status,
    }, { async: true }).catch(err => {
      console.error('Failed to dispatch open orders changed:', err)
    })

    dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      tipTotal: Number(order.tipTotal) || 0,
      discountTotal: totals.discountTotal,
      total: totals.total,
    }, { async: true }).catch(err => {
      console.error('Failed to dispatch order totals update:', err)
    })

    // CFD: update customer display after void/comp (fire-and-forget)
    void (async () => {
      try {
        const activeItemIds = await OrderItemRepository.getItemIdsForOrderWhere(orderId, order.locationId, { status: 'active', deletedAt: null })
        const updatedItems = activeItemIds.length > 0
          ? await OrderItemRepository.getItemsByIdsWithInclude(activeItemIds.map(i => i.id), order.locationId, { modifiers: true })
          : []
        dispatchCFDOrderUpdated(order.locationId, {
          orderId,
          orderNumber: order.orderNumber,
          items: updatedItems.map(i => ({
            name: i.name,
            quantity: i.quantity,
            price: Number(i.itemTotal),
            modifiers: i.modifiers.map(m => m.name),
          })),
          subtotal: totals.subtotal,
          tax: totals.taxTotal,
          total: totals.total,
          discountTotal: totals.discountTotal,
          taxFromInclusive: totals.taxFromInclusive,
          taxFromExclusive: totals.taxFromExclusive,
        })
      } catch (err) {
        console.error('[CompVoid] CFD dispatch failed:', err)
      }
    })()

    // M6: Notify mobile tab clients that items changed (comp/void updates item count)
    dispatchTabItemsUpdated(order.locationId, {
      orderId,
      itemCount: activeItemCount,
    })

    // Dispatch order:summary-updated for Android cross-terminal sync (fire-and-forget)
    void dispatchOrderSummaryUpdated(order.locationId, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: shouldAutoClose ? 'cancelled' : order.status,
      tableId: order.tableId || null,
      tableName: null,
      tabName: order.tabName || null,
      guestCount: order.guestCount ?? 0,
      employeeId: order.employeeId || null,
      subtotalCents: Math.round(totals.subtotal * 100),
      taxTotalCents: Math.round(totals.taxTotal * 100),
      discountTotalCents: Math.round(totals.discountTotal * 100),
      tipTotalCents: Math.round(Number(order.tipTotal) * 100),
      totalCents: Math.round(totals.total * 100),
      itemCount: activeItemCount,
      updatedAt: new Date().toISOString(),
      locationId: order.locationId,
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.comp-void'))
    if (shouldAutoClose) {
      void dispatchOrderClosed(order.locationId, {
        orderId: order.id,
        status: 'cancelled',
        closedAt: new Date().toISOString(),
        closedByEmployeeId: employeeId,
        locationId: order.locationId,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.comp-void'))
    }

    // BUG 1: If this split child was auto-closed, check if ALL siblings are in terminal states.
    // If so, the parent order is orphaned in 'split' status — close it too.
    if (shouldAutoClose && order.parentOrderId) {
      void (async () => {
        try {
          // TODO: Add getOrdersByParentId to OrderRepository for split sibling queries
          const siblings = await db.order.findMany({
            where: { parentOrderId: order.parentOrderId!, locationId: order.locationId, deletedAt: null },
            select: { id: true, status: true },
          })
          const allTerminal = siblings.length > 0 && siblings.every(s => isClosed(s.status))
          if (allTerminal) {
            await OrderRepository.updateOrder(order.parentOrderId!, order.locationId, {
              status: 'cancelled', paidAt: new Date(),
            })
            void dispatchOrderClosed(order.locationId, {
              orderId: order.parentOrderId!,
              status: 'cancelled',
              closedAt: new Date().toISOString(),
              closedByEmployeeId: employeeId,
              locationId: order.locationId,
            }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.comp-void'))
            void dispatchOpenOrdersChanged(order.locationId, {
              trigger: 'voided',
              orderId: order.parentOrderId!,
            }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.comp-void'))
          }
        } catch (err) {
          console.error('[CompVoid] Failed to resolve parent order after all children cancelled:', err)
        }
      })()
    }

    // If this was a split child, also dispatch parent order totals update
    if (order.parentOrderId && parentTotals) {
      void dispatchOrderTotalsUpdate(order.locationId, order.parentOrderId, {
        subtotal: parentTotals.subtotal,
        taxTotal: parentTotals.taxTotal,
        tipTotal: parentTotals.tipTotal,
        discountTotal: parentTotals.discountTotal,
        total: parentTotals.total,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.comp-void'))
      // read back full row to avoid NOT NULL constraint violations on replay
      if (isInOutageMode()) {
        const fullParentOrder = await OrderRepository.getOrderById(order.parentOrderId!, order.locationId)
        if (fullParentOrder) {
          void queueOutageWrite('Order', fullParentOrder.id, 'UPDATE', fullParentOrder as unknown as Record<string, unknown>, order.locationId).catch(err => log.warn({ err }, 'Background task failed'))
        }
      }
    }

    // Overpayment detection: check if completed payments now exceed the new order total
    let overpayment: { amount: number; message: string } | null = null
    if (!shouldAutoClose) {
      const updatedOrder = await OrderRepository.getOrderByIdWithInclude(orderId, order.locationId, {
        payments: { where: { status: 'completed' } },
      })
      if (updatedOrder) {
        const totalPaid = updatedOrder.payments.reduce((sum, p) => sum + Number(p.totalAmount), 0)
        const orderTotal = Number(updatedOrder.total)
        if (totalPaid > orderTotal && totalPaid > 0) {
          const overpaymentAmount = roundToCents(totalPaid - orderTotal)
          console.warn(`[COMP-VOID] OVERPAYMENT DETECTED: Order ${orderId} has $${totalPaid.toFixed(2)} paid against $${orderTotal.toFixed(2)} total. Refund of $${overpaymentAmount.toFixed(2)} may be needed.`)
          overpayment = {
            amount: overpaymentAmount,
            message: `Order is overpaid by $${overpaymentAmount.toFixed(2)}. A refund may be needed.`,
          }
        }
      }
    }

    // Trigger upstream sync (fire-and-forget, debounced)
    pushUpstream()

    return NextResponse.json({ data: {
      success: true,
      action,
      orderAutoClosed: shouldAutoClose,
      item: {
        id: item!.id,
        name: item!.name,
        amount: itemTotal,
        newStatus,
      },
      orderTotals: totals,
      ...(cardReversalWarning ? { cardReversalWarning } : {}),
      ...(overpayment ? { overpayment } : {}),
    } })
  } catch (error) {
    // Handle structured errors from the transaction lock
    if (error instanceof Error) {
      if (error.message === 'ORDER_NOT_FOUND') {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }
      if (error.message === 'ORDER_ALREADY_SETTLED') {
        return NextResponse.json(
          { error: 'Order cannot be modified — it may have been paid or closed by another terminal' },
          { status: 409 }
        )
      }
      if (error.message === 'ITEM_ALREADY_SETTLED') {
        return NextResponse.json(
          { error: 'Item has already been voided or comped' },
          { status: 409 }
        )
      }
      if (error.message === 'ORDER_HAS_COMPLETED_PAYMENTS') {
        return NextResponse.json(
          { error: 'Cannot comp/void — order has completed payments. Void the payment first.' },
          { status: 409 }
        )
      }
    }
    console.error('Failed to comp/void item:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    )
  }
}))

// PUT - Undo a comp/void (restore item)
export const PUT = withVenue(withAuth({ allowCellular: true }, async function PUT(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id: orderId } = await ctx.params
    const body = await request.json()
    const { itemId } = body as { itemId: string; employeeId: string }
    // SECURITY: Use authenticated employee ID for permission check
    const employeeId = ctx.auth.employeeId || body.employeeId

    if (!itemId || !employeeId) {
      return NextResponse.json(
        { error: 'Item ID and employee ID are required' },
        { status: 400 }
      )
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let restoreLocationId = getRequestLocationId()
    if (!restoreLocationId) {
      const restoreLocationCheck = await db.order.findFirst({
        where: { id: orderId },
        select: { locationId: true },
      })
      if (!restoreLocationCheck) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }
      restoreLocationId = restoreLocationCheck.locationId
    }

    const order = await OrderRepository.getOrderByIdWithInclude(orderId, restoreLocationId, {
      location: true,
      items: {
        where: { id: itemId },
        include: {
          modifiers: true,
          menuItem: { select: { id: true, itemType: true } },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Restoring a voided/comped item requires manager void permission
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_VOID_ITEMS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const item = order.items[0]
    const restoreError = validateItemForRestore(item)
    if (restoreError) {
      return NextResponse.json({ error: restoreError.error }, { status: restoreError.status })
    }

    // Wrap item restore + order total recalculation in a single transaction for atomicity.
    const { totals } = await db.$transaction(async (tx) => {
      return applyRestore(
        tx,
        orderId,
        itemId,
        order.location.settings as { tax?: { defaultRate?: number } },
        order.isBottleService,
      )
    })

    // Audit log for restore — captures who undid the comp/void and the previous status
    const previousStatus = item!.status as string // 'comped' or 'voided'
    await db.auditLog.create({
      data: {
        locationId: order.locationId,
        employeeId,
        action: 'item_restored',
        entityType: 'orderItem',
        entityId: itemId,
        details: {
          orderId,
          itemName: item!.name,
          previousStatus,
          reason: item!.voidReason || null,
        },
      },
    })

    // Emit order event for item restore (fire-and-forget)
    void emitOrderEvent(order.locationId, orderId, 'COMP_VOID_APPLIED', {
      lineItemId: itemId,
      action: previousStatus === 'comped' ? 'uncomp' : 'unvoid',
      reason: null,
      employeeId,
      approvedById: null,
    })

    // Fire-and-forget side effects OUTSIDE the transaction

    // Reverse any inventory deduction that occurred during the original void
    void restoreInventoryForRestoredItem(itemId, order.locationId).catch(err => {
      console.error('[Inventory] Failed to reverse deduction on item restore:', err)
    })

    // BUG #379: Restore entertainment status when un-voiding a timed_rental item
    if (item!.menuItem?.itemType === 'timed_rental') {
      void db.menuItem.update({
        where: { id: item!.menuItem.id },
        data: {
          entertainmentStatus: 'in_use',
          currentOrderId: orderId,
          currentOrderItemId: itemId,
        },
      }).then(() => {
        return db.floorPlanElement.updateMany({
          where: { linkedMenuItemId: item!.menuItem!.id, deletedAt: null },
          data: {
            status: 'in_use',
            currentOrderId: orderId,
            sessionStartedAt: item!.blockTimeStartedAt || null,
            sessionExpiresAt: item!.blockTimeExpiresAt || null,
          },
        })
      }).then(() => {
        return dispatchFloorPlanUpdate(order.locationId, { async: true })
      }).catch(err => {
        console.error('[CompVoid] Failed to restore entertainment status:', err)
      })
    }

    return NextResponse.json({ data: {
      success: true,
      item: {
        id: item!.id,
        name: item!.name,
        restored: true,
      },
      orderTotals: totals,
    } })
  } catch (error) {
    console.error('Failed to restore item:', error)
    return NextResponse.json(
      { error: 'Failed to restore item' },
      { status: 500 }
    )
  }
}))

// GET - Get comp/void history for an order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let historyLocationId = getRequestLocationId()
    if (!historyLocationId) {
      const order = await db.order.findFirst({
        where: { id: orderId },
        select: { locationId: true },
      })
      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }
      historyLocationId = order.locationId
    }

    if (!employeeId) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 401 })
    }

    const auth = await requirePermission(employeeId, historyLocationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const voidLogs = await db.voidLog.findMany({
      where: { orderId },
      include: {
        employee: {
          select: { displayName: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ data: {
      logs: voidLogs.map(log => ({
        id: log.id,
        voidType: log.voidType,
        itemId: log.itemId,
        amount: Number(log.amount),
        reason: log.reason,
        wasMade: log.wasMade,
        employeeName: log.employee.displayName ||
          `${log.employee.firstName} ${log.employee.lastName}`,
        approvedById: log.approvedById,
        approvedAt: log.approvedAt?.toISOString() || null,
        createdAt: log.createdAt.toISOString(),
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch void logs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch void history' },
      { status: 500 }
    )
  }
})
