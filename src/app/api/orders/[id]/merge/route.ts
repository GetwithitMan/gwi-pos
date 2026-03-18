import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { getLocationSettings } from '@/lib/location-cache'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate, dispatchFloorPlanUpdate, dispatchTabUpdated, dispatchCFDOrderUpdated, dispatchTableStatusChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'

// POST - Merge another order into this one
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: targetOrderId } = await params
    const body = await request.json()
    const { sourceOrderId, employeeId } = body

    if (!sourceOrderId) {
      return NextResponse.json(
        { error: 'Source order ID is required' },
        { status: 400 }
      )
    }

    if (targetOrderId === sourceOrderId) {
      return NextResponse.json(
        { error: 'Cannot merge an order with itself' },
        { status: 400 }
      )
    }

    // Get target order -- first do a lightweight check to get locationId for tenant-scoped queries
    const targetOrderCheck = await adminDb.order.findUnique({
      where: { id: targetOrderId },
      select: { id: true, locationId: true },
    })
    if (!targetOrderCheck) {
      return NextResponse.json(
        { error: 'Target order not found' },
        { status: 404 }
      )
    }
    const locationId = targetOrderCheck.locationId

    const targetOrder = await OrderRepository.getOrderByIdWithInclude(
      targetOrderId, locationId,
      {
        items: { include: { modifiers: true } },
        discounts: true,
      },
    )

    if (!targetOrder) {
      return NextResponse.json(
        { error: 'Target order not found' },
        { status: 404 }
      )
    }

    // Server-side permission check
    const auth = await requirePermission(employeeId, targetOrder.locationId, PERMISSIONS.MGR_BULK_OPERATIONS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (['paid', 'closed', 'voided', 'cancelled', 'split'].includes(targetOrder.status)) {
      return NextResponse.json(
        { error: `Cannot merge into a ${targetOrder.status} order` },
        { status: 400 }
      )
    }

    // Get source order
    const sourceOrder = await OrderRepository.getOrderByIdWithInclude(
      sourceOrderId, locationId,
      {
        items: { include: { modifiers: true } },
        discounts: true,
      },
    )

    if (!sourceOrder) {
      return NextResponse.json(
        { error: 'Source order not found' },
        { status: 404 }
      )
    }

    if (['paid', 'closed', 'voided', 'cancelled', 'split'].includes(sourceOrder.status)) {
      return NextResponse.json(
        { error: `Cannot merge from a ${sourceOrder.status} order` },
        { status: 400 }
      )
    }

    // Check same location
    if (targetOrder.locationId !== sourceOrder.locationId) {
      return NextResponse.json(
        { error: 'Orders must be from the same location' },
        { status: 400 }
      )
    }

    // Block merging split children from different parent orders
    if (sourceOrder.parentOrderId && targetOrder.parentOrderId && sourceOrder.parentOrderId !== targetOrder.parentOrderId) {
      return NextResponse.json(
        { error: 'Cannot merge split children from different parent orders' },
        { status: 400 }
      )
    }

    // Move items, recalculate totals, void source, and audit log atomically
    const { movedItems, movedDiscounts } = await db.$transaction(async (tx) => {
      // Acquire row-level locks in consistent order (alphabetical by ID) to prevent deadlocks
      const [firstId, secondId] = [sourceOrderId, targetOrderId].sort()
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', firstId)
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', secondId)

      // Re-check both orders are still in valid states after acquiring locks
      const [lockedTarget, lockedSource] = await Promise.all([
        OrderRepository.getOrderByIdWithSelect(targetOrderId, locationId, { status: true }, tx),
        OrderRepository.getOrderByIdWithSelect(sourceOrderId, locationId, { status: true }, tx),
      ])
      if (!lockedTarget || ['paid', 'closed', 'voided', 'cancelled', 'split'].includes(lockedTarget.status)) {
        throw new Error('TARGET_ORDER_INVALID')
      }
      if (!lockedSource || ['paid', 'closed', 'voided', 'cancelled', 'split'].includes(lockedSource.status)) {
        throw new Error('SOURCE_ORDER_INVALID')
      }

      // Move all active (non-soft-deleted) items from source to target
      // NOTE: Uses raw tx.orderItem.updateMany because orderId is a relation field
      // that cannot be set through OrderItemUpdateManyMutationInput
      const moved = await tx.orderItem.updateMany({
        where: { orderId: sourceOrderId, locationId, deletedAt: null },
        data: { orderId: targetOrderId },
      })

      // Update MenuItem.currentOrderId for merged timed_rental items
      await tx.menuItem.updateMany({
        where: {
          currentOrderId: sourceOrderId,
          itemType: 'timed_rental',
        },
        data: { currentOrderId: targetOrderId },
      })
      await tx.floorPlanElement.updateMany({
        where: { currentOrderId: sourceOrderId, deletedAt: null },
        data: { currentOrderId: targetOrderId },
      })

      // Move discounts (if any) - update their orderId
      const movedDisc = await tx.orderDiscount.updateMany({
        where: { orderId: sourceOrderId },
        data: { orderId: targetOrderId },
      })

      // Recalculate target order totals
      const allItems = await OrderItemRepository.getItemsForOrderWithModifiers(
        targetOrderId, locationId, tx,
      ).then(items => items.filter(i => i.status === 'active'))

      const subtotal = allItems.reduce((sum, item) => sum + Number(item.itemTotal), 0)
      const commissionTotal = allItems.reduce((sum, item) => sum + (item.commissionAmount ? Number(item.commissionAmount) : 0), 0)

      // Get all discounts for recalculation
      const allDiscounts = await tx.orderDiscount.findMany({
        where: { orderId: targetOrderId },
      })
      const discountTotal = allDiscounts.reduce((sum, d) => sum + Number(d.amount), 0)

      // Recalculate order totals using centralized split-aware tax engine
      const locationSettings = await getLocationSettings(targetOrder.locationId)
      const mergeCalcItems: OrderItemForCalculation[] = allItems.map(i => ({
        price: Number(i.price), quantity: i.quantity, status: i.status,
        itemTotal: Number(i.itemTotal), isTaxInclusive: i.isTaxInclusive ?? false,
        modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
      }))
      const totals = calculateOrderTotals(
        mergeCalcItems, locationSettings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } },
        discountTotal, 0, undefined, 'card', targetOrder.isTaxExempt,
        Number(targetOrder.inclusiveTaxRate) || undefined
      )

      // Update target order totals and guest count
      const newGuestCount = (targetOrder.guestCount || 1) + (sourceOrder.guestCount || 1)

      await OrderRepository.updateOrder(targetOrderId, locationId, {
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
        discountTotal: totals.discountTotal,
        total: totals.total,
        commissionTotal,
        itemCount: allItems.reduce((sum, i) => sum + i.quantity, 0),
        guestCount: newGuestCount,
        notes: targetOrder.notes
          ? `${targetOrder.notes}\nMerged from order #${sourceOrder.orderNumber}`
          : `Merged from order #${sourceOrder.orderNumber}`,
        version: { increment: 1 },
      }, tx)

      // Void the source order (soft delete)
      await OrderRepository.updateOrder(sourceOrderId, locationId, {
        status: 'voided',
        itemCount: 0,
        notes: sourceOrder.notes
          ? `${sourceOrder.notes}\nMerged into order #${targetOrder.orderNumber}`
          : `Merged into order #${targetOrder.orderNumber}`,
        version: { increment: 1 },
      }, tx)

      // Create audit log entry
      await tx.auditLog.create({
        data: {
          locationId: targetOrder.locationId,
          employeeId,
          action: 'order_merged',
          entityType: 'order',
          entityId: targetOrderId,
          details: {
            sourceOrderId,
            sourceOrderNumber: sourceOrder.orderNumber,
            targetOrderNumber: targetOrder.orderNumber,
            itemsMoved: moved.count,
            discountsMoved: movedDisc.count,
          },
        },
      })

      return { movedItems: moved, movedDiscounts: movedDisc }
    })

    // C12: Release the source order's table after merge (prevent zombie tables)
    if (sourceOrder.tableId && sourceOrder.tableId !== targetOrder.tableId) {
      await db.table.update({ where: { id: sourceOrder.tableId }, data: { status: 'available' } })
      void dispatchTableStatusChanged(locationId, { tableId: sourceOrder.tableId, status: 'available' }).catch(console.error)
      void dispatchFloorPlanUpdate(locationId).catch(console.error)
    }

    // Dispatch socket events for both orders (fire-and-forget)
    void dispatchOpenOrdersChanged(targetOrder.locationId, {
      trigger: 'voided',
      orderId: sourceOrderId,
      tableId: sourceOrder.tableId || undefined,
    }, { async: true }).catch(() => {})
    void dispatchOpenOrdersChanged(targetOrder.locationId, {
      trigger: 'transferred' as any,
      orderId: targetOrderId,
      tableId: targetOrder.tableId || undefined,
    }, { async: true }).catch(() => {})

    // Event emission: target order received merged items
    void emitOrderEvent(targetOrder.locationId, targetOrderId, 'ORDER_METADATA_UPDATED', {
      reason: `Merged ${movedItems.count} items from order #${sourceOrder.orderNumber}`,
    }).catch(console.error)

    // Event emission: source order voided after merge
    void emitOrderEvent(targetOrder.locationId, sourceOrderId, 'ORDER_CLOSED', {
      closedStatus: 'voided',
      reason: `Merged into order #${targetOrder.orderNumber}`,
    }).catch(console.error)

    // Fetch updated target order for response and totals dispatch
    const updatedOrder = await OrderRepository.getOrderByIdWithInclude(
      targetOrderId, locationId,
      {
        items: { include: { modifiers: true } },
        discounts: true,
        employee: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        table: { select: { id: true, name: true } },
      },
    )

    // BUG 4: Dispatch totals update for the target order so terminals showing it get fresh totals
    void dispatchOrderTotalsUpdate(targetOrder.locationId, targetOrderId, {
      subtotal: Number(updatedOrder!.subtotal),
      taxTotal: Number(updatedOrder!.taxTotal),
      tipTotal: Number(updatedOrder!.tipTotal),
      discountTotal: Number(updatedOrder!.discountTotal),
      total: Number(updatedOrder!.total),
    }, { async: true }).catch(() => {})

    // BUG: Merge was missing dispatchTabUpdated — Transfer had it, Merge didn't
    void dispatchTabUpdated(targetOrder.locationId, {
      orderId: targetOrderId,
    }).catch(console.error)

    // CFD: update customer display with merged order (fire-and-forget)
    dispatchCFDOrderUpdated(targetOrder.locationId, {
      orderId: targetOrderId,
      orderNumber: targetOrder.orderNumber,
      items: updatedOrder!.items.filter(i => i.status === 'active').map(i => ({
        name: i.name,
        quantity: i.quantity,
        price: Number(i.itemTotal),
        modifiers: i.modifiers.map(m => m.name),
      })),
      subtotal: Number(updatedOrder!.subtotal),
      tax: Number(updatedOrder!.taxTotal),
      total: Number(updatedOrder!.total),
      discountTotal: Number(updatedOrder!.discountTotal),
      taxFromInclusive: Number(updatedOrder!.taxFromInclusive ?? 0),
      taxFromExclusive: Number(updatedOrder!.taxFromExclusive ?? 0),
    })

    return NextResponse.json({ data: {
      success: true,
      order: {
        ...updatedOrder,
        subtotal: Number(updatedOrder!.subtotal),
        discountTotal: Number(updatedOrder!.discountTotal),
        taxTotal: Number(updatedOrder!.taxTotal),
        tipTotal: Number(updatedOrder!.tipTotal),
        total: Number(updatedOrder!.total),
        items: updatedOrder!.items.map(item => ({
          ...item,
          price: Number(item.price),
          modifierTotal: Number(item.modifierTotal),
          itemTotal: Number(item.itemTotal),
          modifiers: item.modifiers.map(mod => ({
            ...mod,
            price: Number(mod.price),
          })),
        })),
      },
      sourceOrderVoided: true,
      itemsMoved: movedItems.count,
      discountsMoved: movedDiscounts.count,
    } })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'TARGET_ORDER_INVALID') {
        return NextResponse.json(
          { error: 'Target order can no longer be merged — it may have been paid or closed' },
          { status: 409 }
        )
      }
      if (error.message === 'SOURCE_ORDER_INVALID') {
        return NextResponse.json(
          { error: 'Source order can no longer be merged — it may have been paid or closed' },
          { status: 409 }
        )
      }
    }
    console.error('Failed to merge orders:', error)
    return NextResponse.json(
      { error: 'Failed to merge orders' },
      { status: 500 }
    )
  }
})
