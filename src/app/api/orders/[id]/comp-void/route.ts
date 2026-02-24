import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deductInventoryForVoidedItem, restorePrepStockForVoid, restoreInventoryForRestoredItem, WASTE_VOID_REASONS } from '@/lib/inventory-calculations'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { calculateSimpleOrderTotals as calculateOrderTotals, recalculatePercentDiscounts } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { emitCloudEvent } from '@/lib/cloud-events'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'

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
        items: {
          where: { id: itemId },
          include: { modifiers: true },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
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
        const needsApproval = approvalSettings.voidApprovalThreshold === 0
          || itemTotalCheck > approvalSettings.voidApprovalThreshold

        if (needsApproval && !approvedById && !remoteApprovalCode) {
          return NextResponse.json(
            { error: 'Manager approval required for void', requiresApproval: true },
            { status: 403 }
          )
        }
      }
    }

    if (order.status !== 'open' && order.status !== 'in_progress') {
      return NextResponse.json(
        { error: 'Cannot modify a closed order' },
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

      // W1-P1: Collect card payment info for potential Datacap reversal
      // Instead of blocking voids on paid orders, allow the void and attempt card reversal afterward
      const txCardPayments = await tx.payment.findMany({
        where: { orderId, status: 'completed', deletedAt: null },
        select: {
          id: true,
          datacapRecordNo: true,
          paymentReaderId: true,
          totalAmount: true,
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
        },
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
      const txActiveItems = await tx.orderItem.findMany({
        where: {
          orderId,
          status: 'active',
        },
        include: { modifiers: true },
      })

      let newSubtotal = 0
      txActiveItems.forEach(activeItem => {
        const mods = activeItem.modifiers.reduce((sum, m) => sum + Number(m.price), 0)
        newSubtotal += (Number(activeItem.price) + mods) * activeItem.quantity
      })

      // Recalculate percent-based discounts against new subtotal
      const discountTotal = await recalculatePercentDiscounts(tx, orderId, newSubtotal)

      // Recalculate order totals using centralized tax engine
      const txTotals = calculateOrderTotals(newSubtotal, discountTotal, order.location.settings as { tax?: { defaultRate?: number } })

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
        },
      })

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
          for (const payment of reversiblePayments) {
            try {
              if (shouldAutoClose) {
                // All items voided — void the entire sale
                const result = await datacapClient.voidSale(payment.paymentReaderId!, { recordNo: payment.datacapRecordNo! })
                if (result.cmdStatus === 'Approved' || result.cmdStatus === 'Success') {
                  await db.payment.update({ where: { id: payment.id }, data: { status: 'voided' } })
                  console.log(`[CompVoid] Datacap void succeeded for payment ${payment.id} (card ***${payment.cardLast4})`)
                } else {
                  cardReversalWarning = `Card reversal declined for ***${payment.cardLast4}: ${result.textResponse}. Manual refund may be required.`
                  console.warn(`[CompVoid] Datacap void declined for payment ${payment.id}: ${result.textResponse}`)
                }
              } else {
                // Partial void — refund only the voided item amount
                const result = await datacapClient.emvReturn(payment.paymentReaderId!, {
                  amount: itemTotal,
                  recordNo: payment.datacapRecordNo!,
                  cardPresent: false,
                  invoiceNo: orderId,
                })
                if (result.cmdStatus === 'Approved' || result.cmdStatus === 'Success') {
                  await db.payment.update({
                    where: { id: payment.id },
                    data: { refundedAmount: { increment: itemTotal }, refundedAt: new Date() },
                  })
                  console.log(`[CompVoid] Datacap partial refund of $${itemTotal.toFixed(2)} succeeded for payment ${payment.id}`)
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

    // W1-K1: Dispatch KDS event so voided items disappear from KDS screens
    void emitToLocation(order.locationId, 'kds:item-status', {
      orderId,
      itemId,
      status: newStatus,
    }).catch(err => {
      console.error('[CompVoid] Failed to dispatch KDS void event:', err)
    })

    // Fire-and-forget side effects OUTSIDE the transaction

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
    dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'voided',
      orderId,
      tableId: order.tableId || undefined,
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

    // If this was a split child, also dispatch parent order totals update
    if (order.parentOrderId && parentTotals) {
      void dispatchOrderTotalsUpdate(order.locationId, order.parentOrderId, {
        subtotal: parentTotals.subtotal,
        taxTotal: parentTotals.taxTotal,
        tipTotal: 0,
        discountTotal: parentTotals.discountTotal,
        total: parentTotals.total,
      }, { async: true }).catch(() => {})
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
          include: { modifiers: true },
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

    // Restore the item
    await db.orderItem.update({
      where: { id: itemId },
      data: {
        status: 'active',
        voidReason: null,
      },
    })

    // Fire-and-forget: reverse any inventory deduction that occurred during the original void
    // This creates positive adjustment transactions to undo the waste deductions
    void restoreInventoryForRestoredItem(itemId, order.locationId).catch(err => {
      console.error('[Inventory] Failed to reverse deduction on item restore:', err)
    })

    // Recalculate order totals
    const activeItems = await db.orderItem.findMany({
      where: {
        orderId,
        status: 'active',
      },
      include: { modifiers: true },
    })

    let newSubtotal = 0
    activeItems.forEach(activeItem => {
      const mods = activeItem.modifiers.reduce((sum, m) => sum + Number(m.price), 0)
      newSubtotal += (Number(activeItem.price) + mods) * activeItem.quantity
    })

    // Recalculate percent-based discounts against new subtotal
    const discountTotal = await recalculatePercentDiscounts(db, orderId, newSubtotal)

    const totals = calculateOrderTotals(newSubtotal, discountTotal, order.location.settings as { tax?: { defaultRate?: number } })

    await db.order.update({
      where: { id: orderId },
      data: {
        ...totals,
        itemCount: activeItems.reduce((sum, i) => sum + i.quantity, 0),
        ...(order.isBottleService ? { bottleServiceCurrentSpend: totals.subtotal } : {}),
        version: { increment: 1 },
      },
    })

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
