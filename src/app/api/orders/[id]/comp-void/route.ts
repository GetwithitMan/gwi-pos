import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deductInventoryForVoidedItem, restorePrepStockForVoid, WASTE_VOID_REASONS } from '@/lib/inventory-calculations'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { calculateSimpleOrderTotals as calculateOrderTotals } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'

interface CompVoidRequest {
  action: 'comp' | 'void'
  itemId: string
  reason: string
  employeeId: string
  wasMade?: boolean  // Was the item already made? Determines waste tracking
  approvedById?: string  // Manager ID if approval required
  remoteApprovalCode?: string  // 6-digit code from remote manager approval (Skill 121)
}

// POST - Comp or void an item
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json() as CompVoidRequest

    const { action, itemId, reason, employeeId, wasMade, approvedById, remoteApprovalCode } = body

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
    await db.orderItem.update({
      where: { id: itemId },
      data: {
        status: newStatus,
        voidReason: reason,
        wasMade: itemWasMade,
      },
    })

    // Determine the approving manager (from remote approval or direct)
    const effectiveApprovedById = remoteApproval?.manager.id || approvedById || null
    const effectiveApprovedAt = remoteApproval?.approvedAt || (approvedById ? new Date() : null)

    // Create void log entry
    await db.voidLog.create({
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

    // If remote approval was used, mark it as used
    if (remoteApproval) {
      await db.remoteVoidApproval.update({
        where: { id: remoteApproval.id },
        data: {
          status: 'used',
          usedAt: new Date(),
        },
      })
    }

    // Deduct inventory for voids where food was made (fire-and-forget)
    // For comps, food was definitely made so always deduct
    // For voids, use explicit wasMade flag from UI (falls back to reason-based detection)
    const normalizedReason = reason.toLowerCase().replace(/\s+/g, '_')
    const shouldDeductInventory = action === 'comp'
      || (wasMade !== undefined ? wasMade : WASTE_VOID_REASONS.includes(normalizedReason))

    if (shouldDeductInventory) {
      deductInventoryForVoidedItem(itemId, reason, employeeId).catch(err => {
        console.error('Background waste inventory deduction failed:', err)
      })
    } else {
      // For voids where food was NOT made, restore prep stock (fire-and-forget)
      // This handles cases like "never_made", "customer_left", "mistake", etc.
      restorePrepStockForVoid(orderId, [itemId], false).catch(err => {
        console.error('Background prep stock restoration failed:', err)
      })
    }

    // Recalculate order totals
    // Get all active items
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

    // Get existing discounts
    const discounts = await db.orderDiscount.findMany({
      where: { orderId },
    })
    const discountTotal = discounts.reduce((sum, d) => sum + Number(d.amount), 0)

    // Recalculate order totals using centralized tax engine
    const totals = calculateOrderTotals(newSubtotal, discountTotal, order.location.settings as { tax?: { defaultRate?: number } })

    // Update order totals
    await db.order.update({
      where: { id: orderId },
      data: totals,
    })

    // Dispatch real-time updates (fire-and-forget)
    dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'voided',
      orderId,
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

    return NextResponse.json({
      success: true,
      action,
      item: {
        id: item.id,
        name: item.name,
        amount: itemTotal,
        newStatus,
      },
      orderTotals: totals,
    })
  } catch (error) {
    console.error('Failed to comp/void item:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    )
  }
}

// PUT - Undo a comp/void (restore item)
export async function PUT(
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

    const discounts = await db.orderDiscount.findMany({
      where: { orderId },
    })
    const discountTotal = discounts.reduce((sum, d) => sum + Number(d.amount), 0)

    const totals = calculateOrderTotals(newSubtotal, discountTotal, order.location.settings as { tax?: { defaultRate?: number } })

    await db.order.update({
      where: { id: orderId },
      data: totals,
    })

    return NextResponse.json({
      success: true,
      item: {
        id: item.id,
        name: item.name,
        restored: true,
      },
      orderTotals: totals,
    })
  } catch (error) {
    console.error('Failed to restore item:', error)
    return NextResponse.json(
      { error: 'Failed to restore item' },
      { status: 500 }
    )
  }
}

// GET - Get comp/void history for an order
export async function GET(
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

    return NextResponse.json({
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
    })
  } catch (error) {
    console.error('Failed to fetch void logs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch void history' },
      { status: 500 }
    )
  }
}
