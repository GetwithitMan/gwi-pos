import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { handleApiError, NotFoundError, ValidationError } from '@/lib/api-errors'
import { getLocationTaxRate } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'

// ============================================
// DELETE - Delete an empty split check
// ============================================

export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; splitId: string }> }
) {
  try {
    const { id, splitId } = await params

    // Validate split order exists and belongs to this parent
    const splitOrder = await db.order.findUnique({
      where: { id: splitId },
      select: {
        id: true,
        parentOrderId: true,
        locationId: true,
      },
    })

    if (!splitOrder) {
      throw new NotFoundError('Split order')
    }

    if (splitOrder.parentOrderId !== id) {
      throw new ValidationError('Split order does not belong to this parent')
    }

    // Validate no active items
    const activeItemCount = await db.orderItem.count({
      where: { orderId: splitId, deletedAt: null },
    })

    if (activeItemCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete check with items. Move items to another check first.' },
        { status: 400 }
      )
    }

    // Validate no payments
    const paymentCount = await db.payment.count({
      where: { orderId: splitId },
    })

    if (paymentCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete check with payments.' },
        { status: 400 }
      )
    }

    // Get parent order info for socket emit
    const parentOrder = await db.order.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        tableId: true,
        orderNumber: true,
      },
    })

    if (!parentOrder) {
      throw new NotFoundError('Parent order')
    }

    // Soft delete the empty split (preserve audit trail)
    await db.order.update({
      where: { id: splitId },
      data: { deletedAt: new Date(), status: 'cancelled' },
    })

    // Count remaining splits
    const remainingSplits = await db.order.findMany({
      where: { parentOrderId: id, deletedAt: null },
      select: {
        id: true,
        _count: {
          select: {
            payments: true,
          },
        },
      },
    })

    let merged = false

    // Auto-merge if exactly 1 split remains with no payments
    if (remainingSplits.length === 1 && remainingSplits[0]._count.payments === 0) {
      const lastSplit = remainingSplits[0]

      // Get last split's items for totals recalculation
      const lastSplitItems = await db.orderItem.findMany({
        where: { orderId: lastSplit.id, deletedAt: null },
        include: { modifiers: true },
      })

      // Get location for tax rate
      const location = await db.location.findUnique({
        where: { id: parentOrder.locationId },
        select: { settings: true },
      })

      const settings = location?.settings as {
        tax?: { defaultRate?: number }
      } | null
      const taxRate = getLocationTaxRate(settings)

      await db.$transaction(async (tx) => {
        // Move all items back to parent
        await tx.orderItem.updateMany({
          where: { orderId: lastSplit.id },
          data: { orderId: id },
        })

        // Recalculate parent totals from moved items
        const subtotal = lastSplitItems.reduce(
          (sum, item) => sum + Number(item.price) * item.quantity, 0
        )
        const tax = Math.round(subtotal * taxRate * 100) / 100
        const total = Math.round((subtotal + tax) * 100) / 100

        // Restore parent order
        await tx.order.update({
          where: { id },
          data: {
            status: 'open',
            subtotal,
            taxTotal: tax,
            total,
            notes: null,
          },
        })

        // Soft delete the last split (preserve audit trail)
        await tx.order.update({
          where: { id: lastSplit.id },
          data: { deletedAt: new Date(), status: 'cancelled' },
        })

        // Restore any soft-deleted split items on parent
        await tx.orderItem.updateMany({
          where: {
            orderId: id,
            locationId: parentOrder.locationId,
            deletedAt: { not: null },
          },
          data: { deletedAt: null },
        })
      })

      merged = true
    }

    // Fire-and-forget socket emit
    void emitToLocation(parentOrder.locationId, 'orders:list-changed', {
      orderId: id,
      trigger: 'split',
      tableId: parentOrder.tableId || undefined,
    }).catch(() => {})

    if (merged) {
      return NextResponse.json({
        message: 'Last split merged back to parent',
        merged: true,
      })
    }

    return NextResponse.json({ message: 'Check deleted' })
  } catch (error) {
    return handleApiError(error, 'Failed to delete check')
  }
})
