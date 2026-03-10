import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deductInventoryForVoidedItem, restorePrepStockForVoid, restoreInventoryForRestoredItem, WASTE_VOID_REASONS } from '@/lib/inventory-calculations'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { recalculatePercentDiscounts, getLocationTaxRate, calculateSplitTax } from '@/lib/order-calculations'
import { roundToCents, calculateCardPrice } from '@/lib/pricing'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate, dispatchFloorPlanUpdate, dispatchOrderSummaryUpdated, dispatchOrderClosed, dispatchTabItemsUpdated, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { emitCloudEvent } from '@/lib/cloud-events'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { checkOrderClaim } from '@/lib/order-claim'

interface CompVoidRequest {
  action: 'comp' | 'void'
  itemId: string
  reason: string
  employeeId: string
  wasMade?: boolean  // Was the item already made? Determines waste tracking
  approvedById?: string  // Manager ID if approval required
  remoteApprovalCode?: string  // 6-digit code from remote manager approval (Skill 121)
  version?: number  // Optimistic concurrency control
}

// POST - Comp or void an item
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json() as CompVoidRequest

    const { action, itemId, reason, employeeId, wasMade, approvedById, remoteApprovalCode, version } = body

    if (!action || !itemId || !reason || !employeeId) {
      return NextResponse.json(
        { error: 'Action, item ID, reason, and employee ID are required' },
        { status: 400 }
      )
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
    let remoteApproval = null
    if (remoteApprovalCode) {
      remoteApproval = await db.remoteVoidApproval.findFirst({
        where: {
          approvalCode: remoteApprovalCode,
          status: 'approved',
          orderId,
          approvalCodeExpiry: { gt: new Date() },
        },
        include: {
          manager: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
        },
      })

      if (!remoteApproval) {
        return NextResponse.json(
          { error: 'Invalid or expired approval code' },
          { status: 400 }
        )
      }

      // Check if code was for this specific item (if item-level void)
      if (remoteApproval.orderItemId && remoteApproval.orderItemId !== itemId) {
        return NextResponse.json(
          { error: 'Approval code is for a different item' },
          { status: 400 }
        )
      }
    }

    // Get the order and item
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
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
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Block modifications if any completed payment exists
    const hasCompletedPayment = order.payments?.some(p => p.status === 'completed') || false
    if (hasCompletedPayment) {
      return NextResponse.json(
        { error: 'Cannot void/comp item on order with recorded payments. Void the payment first.' },
        { status: 400 }
      )
    }

    // Concurrency check: if client sent a version, verify it matches
    if (version != null && order.version !== version) {
      return NextResponse.json({
        error: 'Order was modified on another terminal',
        conflict: true,
        currentVersion: order.version,
      }, { status: 409 })
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
    }

    // Validate reason against allowed presets (backward compatible — only if presets exist)
    const reasonType = action === 'comp' ? 'comp_reason' : 'void_reason'
    const reasonPresets = reasonType === 'void_reason'
      ? await db.voidReason.findMany({ where: { locationId: order.locationId, isActive: true, deletedAt: null }, select: { id: true, name: true } })
      : await db.compReason.findMany({ where: { locationId: order.locationId, isActive: true, deletedAt: null }, select: { id: true, name: true } })

    if (reasonPresets.length > 0) {
      // Presets are configured — validate the reason matches one
      const reasonMatch = reasonPresets.find(
        r => r.id === reason || r.name.toLowerCase() === reason.toLowerCase()
      )
      if (!reasonMatch) {
        return NextResponse.json(
          { error: `Invalid ${action} reason. Must be one of the configured presets.` },
          { status: 400 }
        )
      }

      // Check employee access rules (only if access rules exist for this reason type)
      const { resolveAllowedReasonIds } = await import('@/app/api/settings/reason-access/allowed/route')
      const { ids: allowedIds, hasRules } = await resolveAllowedReasonIds(order.locationId, employeeId, reasonType)
      if (hasRules && !allowedIds.includes(reasonMatch.id)) {
        return NextResponse.json(
          { error: `You do not have access to use this ${action} reason` },
          { status: 403 }
        )
      }
    }

    // W4-1: Enforce configurable void approval from location settings
    const settings = parseSettings(order.location.settings)
    const approvalSettings = settings.approvals

    if (action === 'void' && approvalSettings.requireVoidApproval) {
      // Calculate item total to check against threshold
      const itemForCheck = order.items[0]
      if (itemForCheck) {
        const modsTotalCheck = itemForCheck.modifiers.reduce((sum, m) => sum + Number(m.price), 0)
        const itemTotalCheck = (Number(itemForCheck.price) + modsTotalCheck) * itemForCheck.quantity

        // If threshold is 0, all voids require approval; otherwise only above threshold
        // Compare in integer cents to avoid float precision issues
        const itemCents = Math.round(itemTotalCheck * 100)
        const thresholdCents = Math.round(approvalSettings.voidApprovalThreshold * 100)
        const needsApproval = thresholdCents === 0
          || itemCents > thresholdCents

        if (needsApproval && !approvedById && !remoteApprovalCode) {
          return NextResponse.json(
            { error: 'Manager approval required for void', requiresApproval: true },
            { status: 403 }
          )
        }
      }
    }

    // W5-11: 2FA enforcement for large voids — requires remote SMS approval specifically
    const securitySettings = settings.security
    if (action === 'void' && securitySettings.require2FAForLargeVoids) {
      const itemForCheck = order.items[0]
      if (itemForCheck) {
        const modsTotalCheck = itemForCheck.modifiers.reduce((sum, m) => sum + Number(m.price), 0)
        const itemTotalCheck = (Number(itemForCheck.price) + modsTotalCheck) * itemForCheck.quantity

        // Compare in integer cents to avoid float precision issues
        if (Math.round(itemTotalCheck * 100) > Math.round(securitySettings.void2FAThreshold * 100) && !remoteApprovalCode) {
          return NextResponse.json(
            { error: `Remote manager approval required for void over $${securitySettings.void2FAThreshold}`, requiresRemoteApproval: true },
            { status: 403 }
          )
        }
      }
    }

    // Guard: cannot void/cancel a split parent with unpaid children
    if (order.status === 'split') {
      const unpaidChildren = await db.order.count({
        where: {
          parentOrderId: order.id,
          status: { notIn: ['paid', 'closed', 'voided', 'cancelled'] },
          deletedAt: null,
        },
      });
      if (unpaidChildren > 0) {
        return NextResponse.json(
          { error: `Cannot void split parent with ${unpaidChildren} unpaid split children. Void or pay children first.` },
          { status: 400 }
        );
      }
    }

    const COMP_VOID_ALLOWED_STATUSES = ['open', 'in_progress', 'sent', 'draft'];
    if (!COMP_VOID_ALLOWED_STATUSES.includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot comp/void items on order in '${order.status}' status` },
        { status: 400 }
      )
    }

    const item = order.items[0]
    if (!item) {
      return NextResponse.json(
        { error: 'Item not found on this order' },
        { status: 404 }
      )
    }

    if (item.status !== 'active') {
      return NextResponse.json(
        { error: `Item is already ${item.status}` },
        { status: 400 }
      )
    }

    // Calculate the item total (price + modifiers) * quantity
    const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0)
    const itemTotal = (Number(item.price) + modifiersTotal) * item.quantity

    // Update the item status
    const newStatus = action === 'comp' ? 'comped' : 'voided'
    const itemWasMade = action === 'comp' ? true : (wasMade ?? false)

    // Determine the approving manager (from remote approval or direct)
    const effectiveApprovedById = remoteApproval?.manager.id || approvedById || null
    const effectiveApprovedAt = remoteApproval?.approvedAt || (approvedById ? new Date() : null)

    // Wrap all critical writes in a single transaction
    const { activeItems, totals, shouldAutoClose, parentTotals, cardPayments } = await db.$transaction(async (tx) => {
      // 0. Acquire row-level lock to prevent void-during-payment race condition
      const [lockedOrder] = await tx.$queryRaw<any[]>`
        SELECT "status" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `

      if (!lockedOrder) {
        throw new Error('ORDER_NOT_FOUND')
      }

      if (['paid', 'closed', 'voided'].includes(lockedOrder.status)) {
        throw new Error('ORDER_ALREADY_SETTLED')
      }

      // Re-check item status inside the lock to prevent double comp/void
      const freshItem = await tx.orderItem.findFirst({ where: { id: itemId, orderId } })
      if (!freshItem || freshItem.status !== 'active') {
        throw new Error('ITEM_ALREADY_SETTLED')
      }

      // W1-P1: Collect card payment info for potential Datacap reversal
      // Instead of blocking voids on paid orders, allow the void and attempt card reversal afterward
      const txCardPayments = await tx.payment.findMany({
        where: { orderId, status: 'completed', deletedAt: null },
        select: {
          id: true,
          datacapRecordNo: true,
          paymentReaderId: true,
          totalAmount: true,
          refundedAmount: true,
          cardLast4: true,
          paymentMethod: true,
        },
      })

      // 1. Update item status
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          status: newStatus,
          voidReason: reason,
          wasMade: itemWasMade,
          lastMutatedBy: 'local',
        },
      })

      // 1b. Soft-delete any OrderItemDiscount records for the voided/comped item
      // Without this, orphaned discount records remain and corrupt totals
      await tx.orderItemDiscount.updateMany({
        where: { orderItemId: itemId, deletedAt: null },
        data: { deletedAt: new Date() },
      })

      // 2. Create void log entry
      await tx.voidLog.create({
        data: {
          locationId: order.locationId,
          orderId,
          employeeId,
          voidType: 'item',
          itemId,
          amount: itemTotal,
          reason,
          wasMade: action === 'comp' ? true : (wasMade ?? false),
          approvedById: effectiveApprovedById,
          approvedAt: effectiveApprovedAt,
          remoteApprovalId: remoteApproval?.id || null,
        },
      })

      // 2b. W4-1: Log void/comp to AuditLog (in addition to VoidLog)
      await tx.auditLog.create({
        data: {
          locationId: order.locationId,
          employeeId,
          action: action === 'void' ? 'item_voided' : 'item_comped',
          entityType: 'order',
          entityId: orderId,
          details: {
            itemId,
            itemName: item.name,
            quantity: item.quantity,
            amount: itemTotal,
            reason,
            wasMade: itemWasMade,
            approvedBy: effectiveApprovedById,
            remoteApproval: !!remoteApproval,
          },
        },
      })

      // W4-1: Log manager override if approval was provided
      if (effectiveApprovedById && effectiveApprovedById !== employeeId) {
        await tx.auditLog.create({
          data: {
            locationId: order.locationId,
            employeeId: effectiveApprovedById,
            action: 'manager_override',
            entityType: 'order',
            entityId: orderId,
            details: {
              overrideType: action,
              itemId,
              itemName: item.name,
              amount: itemTotal,
              requestedBy: employeeId,
              approvedBy: effectiveApprovedById,
              reason,
            },
          },
        })
      }

      // 3. If remote approval was used, mark it as used
      if (remoteApproval) {
        await tx.remoteVoidApproval.update({
          where: { id: remoteApproval.id },
          data: {
            status: 'used',
            usedAt: new Date(),
          },
        })
      }

      // 4. Recalculate order totals — get all active items
      // H-FIN-7: Include isTaxInclusive to handle tax-inclusive pricing correctly
      const txActiveItems = await tx.orderItem.findMany({
        where: {
          orderId,
          status: 'active',
        },
        include: { modifiers: true },
      })

      // H-FIN-7: Split items into tax-inclusive vs tax-exclusive subtotals
      let inclusiveSubtotal = 0
      let exclusiveSubtotal = 0
      txActiveItems.forEach(activeItem => {
        const mods = activeItem.modifiers.reduce((sum, m) => sum + Number(m.price), 0)
        const itemTotal = (Number(activeItem.price) + mods) * activeItem.quantity
        if ((activeItem as any).isTaxInclusive) {
          inclusiveSubtotal += itemTotal
        } else {
          exclusiveSubtotal += itemTotal
        }
      })
      inclusiveSubtotal = roundToCents(inclusiveSubtotal)
      exclusiveSubtotal = roundToCents(exclusiveSubtotal)
      const newSubtotal = roundToCents(inclusiveSubtotal + exclusiveSubtotal)

      // Recalculate percent-based order-level discounts against new subtotal
      const orderLevelDiscount = await recalculatePercentDiscounts(tx, orderId, newSubtotal)

      // Sum item-level discounts from active (non-deleted) OrderItemDiscount records
      const activeItemDiscounts = await tx.orderItemDiscount.findMany({
        where: { orderId, deletedAt: null },
        select: { amount: true },
      })
      const itemLevelDiscount = activeItemDiscounts.reduce((sum, d) => sum + Number(d.amount), 0)
      const discountTotal = roundToCents(orderLevelDiscount + itemLevelDiscount)

      // H-FIN-7: Use split tax calculation for tax-inclusive pricing support
      const taxRate = getLocationTaxRate(order.location.settings as { tax?: { defaultRate?: number } })
      const splitTax = calculateSplitTax(inclusiveSubtotal, exclusiveSubtotal, taxRate)
      const effectiveDiscount = Math.min(discountTotal, newSubtotal)
      // Inclusive items already contain tax; exclusive items get taxFromExclusive added on top
      const txTotals = {
        subtotal: newSubtotal,
        discountTotal: effectiveDiscount,
        taxTotal: splitTax.totalTax,
        total: roundToCents(inclusiveSubtotal + exclusiveSubtotal + splitTax.taxFromExclusive - effectiveDiscount),
      }

      // If all items are voided/comped (total is $0 with no active items), auto-close the order
      const txShouldAutoClose = txActiveItems.length === 0

      // 5. Update order with recalculated totals + increment version
      const txItemCount = txActiveItems.reduce((sum, i) => sum + i.quantity, 0)
      await tx.order.update({
        where: { id: orderId },
        data: {
          ...txTotals,
          itemCount: txItemCount,
          ...(order.isBottleService ? { bottleServiceCurrentSpend: txTotals.subtotal } : {}),
          ...(txShouldAutoClose ? { status: 'cancelled', paidAt: new Date() } : {}),
          version: { increment: 1 },
          lastMutatedBy: 'local',
        },
      })

      // 5b. Recalculate commission from active items only (voided item's commission must not persist)
      const activeCommissionItems = await tx.orderItem.findMany({
        where: { orderId, status: 'active', deletedAt: null },
        include: { menuItem: { select: { commissionType: true, commissionValue: true } } },
      })
      let newCommission = 0
      for (const ci of activeCommissionItems) {
        if (!ci.menuItem?.commissionType || !ci.menuItem?.commissionValue) continue
        const val = Number(ci.menuItem.commissionValue)
        const qty = ci.quantity || 1
        const ciTotal = Number(ci.itemTotal ?? 0)
        newCommission += ci.menuItem.commissionType === 'percent'
          ? roundToCents(ciTotal * (val / 100))
          : roundToCents(val * qty)
      }
      await tx.order.update({ where: { id: orderId }, data: { commissionTotal: newCommission } })
      // Zero the voided/comped item's own commission
      await tx.orderItem.update({ where: { id: itemId }, data: { commissionAmount: 0 } })

      // 6. If this is a split child, update parent order totals to match sum of siblings
      let txParentTotals: { subtotal: number; taxTotal: number; total: number; discountTotal: number; itemCount: number } | null = null
      if (order.parentOrderId) {
        // Bug 4: Also select discountTotal for parent recalculation
        // Bug 10: Include items to count active items across siblings
        const siblings = await tx.order.findMany({
          where: { parentOrderId: order.parentOrderId, deletedAt: null },
          select: {
            subtotal: true,
            taxTotal: true,
            total: true,
            discountTotal: true,
            items: {
              where: { status: 'active', deletedAt: null },
              select: { quantity: true },
            },
          },
        })
        const parentSubtotal = siblings.reduce((sum, s) => sum + Number(s.subtotal), 0)
        const parentTaxTotal = siblings.reduce((sum, s) => sum + Number(s.taxTotal), 0)
        const parentTotal = siblings.reduce((sum, s) => sum + Number(s.total), 0)
        const parentDiscountTotal = siblings.reduce((sum, s) => sum + Number(s.discountTotal), 0)
        const parentItemCount = siblings.reduce(
          (sum, s) => sum + s.items.reduce((iSum, i) => iSum + i.quantity, 0), 0
        )

        await tx.order.update({
          where: { id: order.parentOrderId },
          data: {
            subtotal: parentSubtotal,
            taxTotal: parentTaxTotal,
            total: parentTotal,
            discountTotal: parentDiscountTotal,
            itemCount: parentItemCount,
          },
        })

        txParentTotals = {
          subtotal: parentSubtotal,
          taxTotal: parentTaxTotal,
          total: parentTotal,
          discountTotal: parentDiscountTotal,
          itemCount: parentItemCount,
        }
      }

      return { activeItems: txActiveItems, totals: txTotals, shouldAutoClose: txShouldAutoClose, parentTotals: txParentTotals, cardPayments: txCardPayments }
    })

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
                      await db.payment.update({
                        where: { id: payment.id },
                        data: { status: 'voided', refundedAmount: payment.totalAmount, refundedAt: new Date() },
                      })
                      console.log(`[CompVoid] Datacap remaining refund of $${remainingToRefund.toFixed(2)} succeeded for payment ${payment.id} (card ***${payment.cardLast4})`)
                    } else {
                      cardReversalWarning = `Card refund declined for ***${payment.cardLast4}: ${result.textResponse}. Manual refund may be required.`
                      console.warn(`[CompVoid] Datacap remaining refund declined for payment ${payment.id}: ${result.textResponse}`)
                    }
                  } else {
                    // Already fully refunded via previous partial refunds — just mark voided
                    await db.payment.update({ where: { id: payment.id }, data: { status: 'voided' } })
                    console.log(`[CompVoid] Payment ${payment.id} already fully refunded, marked voided`)
                  }
                } else {
                  // No previous refunds — safe to void the entire sale
                  const result = await datacapClient.voidSale(payment.paymentReaderId!, { recordNo: payment.datacapRecordNo! })
                  if (result.cmdStatus === 'Approved' || result.cmdStatus === 'Success') {
                    await db.payment.update({ where: { id: payment.id }, data: { status: 'voided' } })
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
                  await db.payment.update({
                    where: { id: payment.id },
                    data: { refundedAmount: { increment: refundAmount }, refundedAt: new Date() },
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

    // Fire-and-forget side effects OUTSIDE the transaction

    // BUG #378: Reset entertainment status when voiding a timed_rental item
    // Only void — comp means customer plays for free but is still using the item
    if (action === 'void' && item.menuItem?.itemType === 'timed_rental') {
      void db.menuItem.update({
        where: { id: item.menuItem.id },
        data: {
          entertainmentStatus: 'available',
          currentOrderId: null,
          currentOrderItemId: null,
        },
      }).then(() => {
        // Also reset the floor plan element linked to this menu item
        return db.floorPlanElement.updateMany({
          where: { linkedMenuItemId: item.menuItem!.id, deletedAt: null },
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
        itemId: item.menuItem!.id,
        entertainmentStatus: 'available',
        currentOrderId: null,
        expiresAt: null,
      }, { async: true }).catch(() => {})

      void notifyNextWaitlistEntry(order.locationId, item.menuItem.id, item.menuItem.name).catch(() => {})
    }

    // Deduct inventory for voids where food was made
    const normalizedReason = reason.toLowerCase().replace(/\s+/g, '_')
    const shouldDeductInventory = action === 'comp'
      || (wasMade !== undefined ? wasMade : WASTE_VOID_REASONS.includes(normalizedReason))

    if (shouldDeductInventory) {
      deductInventoryForVoidedItem(itemId, reason, employeeId).catch(err => {
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
      if (order.tableId) {
        await db.table.update({ where: { id: order.tableId }, data: { status: 'available' } })
        void dispatchFloorPlanUpdate(order.locationId).catch(console.error)
      }

      void cleanupTemporarySeats(orderId)
        .then(() => {
          if (order.tableId) {
            return dispatchFloorPlanUpdate(order.locationId, { async: true })
          }
        })
        .catch(console.error)
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
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: Number(item.price),
      }],
    }).catch(console.error)

    // Dispatch real-time updates (fire-and-forget)
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

    // M6: Notify mobile tab clients that items changed (comp/void updates item count)
    dispatchTabItemsUpdated(order.locationId, {
      orderId,
      itemCount: activeItems.reduce((sum, i) => sum + i.quantity, 0),
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
      itemCount: activeItems.reduce((sum, i) => sum + i.quantity, 0),
      updatedAt: new Date().toISOString(),
      locationId: order.locationId,
    }, { async: true }).catch(() => {})

    // Dispatch order:closed when all items voided/comped (auto-close)
    if (shouldAutoClose) {
      void dispatchOrderClosed(order.locationId, {
        orderId: order.id,
        status: 'cancelled',
        closedAt: new Date().toISOString(),
        closedByEmployeeId: employeeId,
        locationId: order.locationId,
      }, { async: true }).catch(() => {})
    }

    // BUG 1: If this split child was auto-closed, check if ALL siblings are in terminal states.
    // If so, the parent order is orphaned in 'split' status — close it too.
    if (shouldAutoClose && order.parentOrderId) {
      void (async () => {
        try {
          const TERMINAL_STATUSES = ['paid', 'closed', 'cancelled', 'voided']
          const siblings = await db.order.findMany({
            where: { parentOrderId: order.parentOrderId!, deletedAt: null },
            select: { id: true, status: true },
          })
          const allTerminal = siblings.length > 0 && siblings.every(s => TERMINAL_STATUSES.includes(s.status))
          if (allTerminal) {
            await db.order.update({
              where: { id: order.parentOrderId! },
              data: { status: 'cancelled', paidAt: new Date() },
            })
            void dispatchOrderClosed(order.locationId, {
              orderId: order.parentOrderId!,
              status: 'cancelled',
              closedAt: new Date().toISOString(),
              closedByEmployeeId: employeeId,
              locationId: order.locationId,
            }, { async: true }).catch(() => {})
            void dispatchOpenOrdersChanged(order.locationId, {
              trigger: 'voided',
              orderId: order.parentOrderId!,
            }, { async: true }).catch(() => {})
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
        tipTotal: 0,
        discountTotal: parentTotals.discountTotal,
        total: parentTotals.total,
      }, { async: true }).catch(() => {})

      // Queue outage write for parent order totals if Neon is unreachable
      if (isInOutageMode()) {
        void queueOutageWrite('Order', order.parentOrderId, 'UPDATE', {
          id: order.parentOrderId,
          subtotal: parentTotals.subtotal,
          taxTotal: parentTotals.taxTotal,
          total: parentTotals.total,
          discountTotal: parentTotals.discountTotal,
          itemCount: parentTotals.itemCount,
        }, order.locationId).catch(console.error)
      }
    }

    // Overpayment detection: check if completed payments now exceed the new order total
    let overpayment: { amount: number; message: string } | null = null
    if (!shouldAutoClose) {
      const updatedOrder = await db.order.findUnique({
        where: { id: orderId },
        include: { payments: { where: { status: 'completed' } } },
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

    return NextResponse.json({ data: {
      success: true,
      action,
      orderAutoClosed: shouldAutoClose,
      item: {
        id: item.id,
        name: item.name,
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
    }
    console.error('Failed to comp/void item:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    )
  }
})

// PUT - Undo a comp/void (restore item)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { itemId, employeeId } = body as { itemId: string; employeeId: string }

    if (!itemId || !employeeId) {
      return NextResponse.json(
        { error: 'Item ID and employee ID are required' },
        { status: 400 }
      )
    }

    // Get the order and item
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        location: true,
        items: {
          where: { id: itemId },
          include: {
            modifiers: true,
            menuItem: { select: { id: true, itemType: true } },
          },
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
    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }

    if (item.status === 'active') {
      return NextResponse.json(
        { error: 'Item is already active' },
        { status: 400 }
      )
    }

    // Wrap item restore + order total recalculation in a single transaction for atomicity.
    // Without this, a concurrent payment or void could see inconsistent state between
    // the item status change and the order total update.
    const { totals } = await db.$transaction(async (tx) => {
      // 1. Restore the item
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          status: 'active',
          voidReason: null,
        },
      })

      // 1b. Restore any OrderItemDiscount records that were soft-deleted when the item was voided/comped
      await tx.orderItemDiscount.updateMany({
        where: { orderItemId: itemId, deletedAt: { not: null } },
        data: { deletedAt: null },
      })

      // 2. Recalculate order totals
      // H-FIN-7: Include isTaxInclusive to handle tax-inclusive pricing correctly
      const activeItems = await tx.orderItem.findMany({
        where: {
          orderId,
          status: 'active',
        },
        include: { modifiers: true },
      })

      let restoreInclusiveSubtotal = 0
      let restoreExclusiveSubtotal = 0
      activeItems.forEach(activeItem => {
        const mods = activeItem.modifiers.reduce((sum, m) => sum + Number(m.price), 0)
        const total = (Number(activeItem.price) + mods) * activeItem.quantity
        if ((activeItem as any).isTaxInclusive) {
          restoreInclusiveSubtotal += total
        } else {
          restoreExclusiveSubtotal += total
        }
      })
      restoreInclusiveSubtotal = roundToCents(restoreInclusiveSubtotal)
      restoreExclusiveSubtotal = roundToCents(restoreExclusiveSubtotal)
      const newSubtotal = roundToCents(restoreInclusiveSubtotal + restoreExclusiveSubtotal)

      // Recalculate percent-based order-level discounts against new subtotal
      const orderLevelDiscount = await recalculatePercentDiscounts(tx, orderId, newSubtotal)

      // Sum item-level discounts from active (non-deleted) OrderItemDiscount records (includes restored ones)
      const restoreItemDiscounts = await tx.orderItemDiscount.findMany({
        where: { orderId, deletedAt: null },
        select: { amount: true },
      })
      const restoreItemLevelDiscount = restoreItemDiscounts.reduce((sum, d) => sum + Number(d.amount), 0)
      const discountTotal = roundToCents(orderLevelDiscount + restoreItemLevelDiscount)

      // H-FIN-7: Use split tax calculation for tax-inclusive pricing support
      const restoreTaxRate = getLocationTaxRate(order.location.settings as { tax?: { defaultRate?: number } })
      const restoreSplitTax = calculateSplitTax(restoreInclusiveSubtotal, restoreExclusiveSubtotal, restoreTaxRate)
      const restoreEffectiveDiscount = Math.min(discountTotal, newSubtotal)
      const txTotals = {
        subtotal: newSubtotal,
        discountTotal: restoreEffectiveDiscount,
        taxTotal: restoreSplitTax.totalTax,
        total: roundToCents(restoreInclusiveSubtotal + restoreExclusiveSubtotal + restoreSplitTax.taxFromExclusive - restoreEffectiveDiscount),
      }

      // 3. Update order with recalculated totals
      await tx.order.update({
        where: { id: orderId },
        data: {
          ...txTotals,
          itemCount: activeItems.reduce((sum, i) => sum + i.quantity, 0),
          ...(order.isBottleService ? { bottleServiceCurrentSpend: txTotals.subtotal } : {}),
          version: { increment: 1 },
        },
      })

      return { totals: txTotals }
    })

    // Emit order event for item restore (fire-and-forget)
    void emitOrderEvent(order.locationId, orderId, 'COMP_VOID_APPLIED', {
      lineItemId: itemId,
      action: item.status === 'comped' ? 'uncomp' : 'unvoid',
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
    if (item.menuItem?.itemType === 'timed_rental') {
      void db.menuItem.update({
        where: { id: item.menuItem.id },
        data: {
          entertainmentStatus: 'in_use',
          currentOrderId: orderId,
          currentOrderItemId: itemId,
        },
      }).then(() => {
        return db.floorPlanElement.updateMany({
          where: { linkedMenuItemId: item.menuItem!.id, deletedAt: null },
          data: {
            status: 'in_use',
            currentOrderId: orderId,
            sessionStartedAt: item.blockTimeStartedAt || null,
            sessionExpiresAt: item.blockTimeExpiresAt || null,
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
        id: item.id,
        name: item.name,
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
})

// GET - Get comp/void history for an order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')

    // Get order to determine locationId for auth check
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { locationId: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (!employeeId) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 401 })
    }

    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
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
