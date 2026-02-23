import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deductInventoryForVoidedItem, restorePrepStockForVoid, restoreInventoryForRestoredItem, WASTE_VOID_REASONS } from '@/lib/inventory-calculations'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { calculateSimpleOrderTotals as calculateOrderTotals, recalculatePercentDiscounts } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { cleanupTemporarySeats } from '@/lib/cleanup-temp-seats'
import { emitCloudEvent } from '@/lib/cloud-events'
import { withVenue } from '@/lib/with-venue'

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

    if (order.status !== 'open' && order.status !== 'in_progress') {
      return NextResponse.json(
        { error: 'Cannot modify a closed order' },
        { status: 400 }
      )
    }

    // Check for existing completed payments
    const completedPayments = await db.payment.findFirst({
      where: { orderId, status: 'completed', deletedAt: null },
      select: { id: true },
    })
    if (completedPayments) {
      return NextResponse.json(
        { error: 'Cannot modify an order with existing payments. Void the payment first.' },
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
    const { activeItems, totals, shouldAutoClose, parentTotals } = await db.$transaction(async (tx) => {
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
      let txParentTotals: { subtotal: number; taxTotal: number; total: number } | null = null
      if (order.parentOrderId) {
        const siblings = await tx.order.findMany({
          where: { parentOrderId: order.parentOrderId, deletedAt: null },
          select: { subtotal: true, taxTotal: true, total: true },
        })
        const parentSubtotal = siblings.reduce((sum, s) => sum + Number(s.subtotal), 0)
        const parentTaxTotal = siblings.reduce((sum, s) => sum + Number(s.taxTotal), 0)
        const parentTotal = siblings.reduce((sum, s) => sum + Number(s.total), 0)

        await tx.order.update({
          where: { id: order.parentOrderId },
          data: { subtotal: parentSubtotal, taxTotal: parentTaxTotal, total: parentTotal },
        })

        txParentTotals = { subtotal: parentSubtotal, taxTotal: parentTaxTotal, total: parentTotal }
      }

      return { activeItems: txActiveItems, totals: txTotals, shouldAutoClose: txShouldAutoClose, parentTotals: txParentTotals }
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
        discountTotal: 0,
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
