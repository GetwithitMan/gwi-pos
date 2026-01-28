import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Merge another order into this one
export async function POST(
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

    // Get target order
    const targetOrder = await db.order.findUnique({
      where: { id: targetOrderId },
      include: {
        items: {
          include: { modifiers: true }
        },
        discounts: true,
      },
    })

    if (!targetOrder) {
      return NextResponse.json(
        { error: 'Target order not found' },
        { status: 404 }
      )
    }

    if (targetOrder.status === 'paid' || targetOrder.status === 'closed' || targetOrder.status === 'voided') {
      return NextResponse.json(
        { error: 'Cannot merge into a paid/closed/voided order' },
        { status: 400 }
      )
    }

    // Get source order
    const sourceOrder = await db.order.findUnique({
      where: { id: sourceOrderId },
      include: {
        items: {
          include: { modifiers: true }
        },
        discounts: true,
      },
    })

    if (!sourceOrder) {
      return NextResponse.json(
        { error: 'Source order not found' },
        { status: 404 }
      )
    }

    if (sourceOrder.status === 'paid' || sourceOrder.status === 'closed' || sourceOrder.status === 'voided') {
      return NextResponse.json(
        { error: 'Cannot merge from a paid/closed/voided order' },
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

    // Move all items from source to target
    const movedItems = await db.orderItem.updateMany({
      where: { orderId: sourceOrderId },
      data: { orderId: targetOrderId },
    })

    // Move discounts (if any) - update their orderId
    const movedDiscounts = await db.orderDiscount.updateMany({
      where: { orderId: sourceOrderId },
      data: { orderId: targetOrderId },
    })

    // Recalculate target order totals
    const allItems = await db.orderItem.findMany({
      where: { orderId: targetOrderId, status: 'active' },
      include: { modifiers: true },
    })

    const subtotal = allItems.reduce((sum, item) => sum + Number(item.itemTotal), 0)
    const commissionTotal = allItems.reduce((sum, item) => sum + (item.commissionAmount ? Number(item.commissionAmount) : 0), 0)

    // Get all discounts for recalculation
    const allDiscounts = await db.orderDiscount.findMany({
      where: { orderId: targetOrderId },
    })
    const discountTotal = allDiscounts.reduce((sum, d) => sum + Number(d.amount), 0)

    // Get tax rate from location settings
    const location = await db.location.findUnique({
      where: { id: targetOrder.locationId },
      select: { settings: true },
    })

    const taxRate = (location?.settings as Record<string, unknown>)?.tax
      ? ((location?.settings as Record<string, unknown>)?.tax as Record<string, unknown>)?.defaultRate as number || 8.0
      : 8.0

    const taxableAmount = subtotal - discountTotal
    const taxTotal = taxableAmount * (taxRate / 100)
    const total = taxableAmount + taxTotal

    // Update target order totals and guest count
    const newGuestCount = (targetOrder.guestCount || 1) + (sourceOrder.guestCount || 1)

    await db.order.update({
      where: { id: targetOrderId },
      data: {
        subtotal,
        discountTotal,
        taxTotal,
        total,
        commissionTotal,
        guestCount: newGuestCount,
        notes: targetOrder.notes
          ? `${targetOrder.notes}\nMerged from order #${sourceOrder.orderNumber}`
          : `Merged from order #${sourceOrder.orderNumber}`,
      },
    })

    // Void the source order (soft delete)
    await db.order.update({
      where: { id: sourceOrderId },
      data: {
        status: 'voided',
        notes: sourceOrder.notes
          ? `${sourceOrder.notes}\nMerged into order #${targetOrder.orderNumber}`
          : `Merged into order #${targetOrder.orderNumber}`,
      },
    })

    // Create audit log entry
    await db.auditLog.create({
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
          itemsMoved: movedItems.count,
          discountsMoved: movedDiscounts.count,
        },
      },
    })

    // Return updated target order
    const updatedOrder = await db.order.findUnique({
      where: { id: targetOrderId },
      include: {
        items: {
          include: { modifiers: true },
        },
        discounts: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, displayName: true },
        },
        table: {
          select: { id: true, name: true },
        },
      },
    })

    return NextResponse.json({
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
    })
  } catch (error) {
    console.error('Failed to merge orders:', error)
    return NextResponse.json(
      { error: 'Failed to merge orders' },
      { status: 500 }
    )
  }
}
