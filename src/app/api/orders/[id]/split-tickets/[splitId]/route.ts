import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { OrderStatus } from '@/generated/prisma/client'
import { handleApiError, NotFoundError, ValidationError } from '@/lib/api-errors'
import { getLocationTaxRate, calculateSplitTax } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { OrderRepository, OrderItemRepository, PaymentRepository } from '@/lib/repositories'

// ============================================
// DELETE - Delete an empty split check
// ============================================

export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; splitId: string }> }
) {
  try {
    const { id, splitId } = await params

    // TODO: Initial split lookup uses raw db because locationId is unknown until fetch.
    // Once withVenue injects locationId, replace with OrderRepository.getOrderByIdWithSelect.
    const splitOrder = await adminDb.order.findFirst({
      where: { id: splitId, deletedAt: null },
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

    const locationId = splitOrder.locationId

    // Validate no active items
    const activeItemCount = await OrderItemRepository.countItemsForOrder(splitId, locationId)

    if (activeItemCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete check with items. Move items to another check first.' },
        { status: 400 }
      )
    }

    // Validate no payments
    const paymentCount = await PaymentRepository.countPayments(locationId, { orderId: splitId })

    if (paymentCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete check with payments.' },
        { status: 400 }
      )
    }

    // Get parent order info for socket emit
    const parentOrder = await OrderRepository.getOrderByIdWithSelect(
      id,
      locationId,
      {
        id: true,
        locationId: true,
        tableId: true,
        orderNumber: true,
        inclusiveTaxRate: true,
      },
    )

    if (!parentOrder) {
      throw new NotFoundError('Parent order')
    }

    // Soft delete the empty split (preserve audit trail)
    await OrderRepository.updateOrder(splitId, locationId, {
      deletedAt: new Date(),
      status: 'cancelled' as OrderStatus,
    })

    // Count remaining splits
    // TODO: Complex query with _count -- no repository method; uses raw db
    const remainingSplits = await adminDb.order.findMany({
      where: { parentOrderId: id, locationId, deletedAt: null },
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
      const lastSplitItems = await OrderItemRepository.getItemsForOrderWithModifiers(lastSplit.id, locationId)

      // Get location for tax rate
      const location = await db.location.findUnique({
        where: { id: parentOrder.locationId },
        select: { settings: true },
      })

      const settings = location?.settings as {
        tax?: { defaultRate?: number; inclusiveTaxRate?: number }
      } | null
      const taxRate = getLocationTaxRate(settings)
      // Prefer order-level snapshot; fall back to location setting with > 0 guard
      const autoMergeOrderInclRate = Number(parentOrder.inclusiveTaxRate) || undefined
      const autoMergeInclRateRaw = settings?.tax?.inclusiveTaxRate
      const autoMergeInclusiveRate = autoMergeOrderInclRate
        ?? (autoMergeInclRateRaw != null && Number.isFinite(autoMergeInclRateRaw) && autoMergeInclRateRaw > 0
          ? autoMergeInclRateRaw / 100 : undefined)

      await db.$transaction(async (tx) => {
        // TX-KEEP: RELATION — move items back to parent order; orderId is a relation FK not in OrderItemUpdateManyMutationInput
        await tx.orderItem.updateMany({
          where: { orderId: lastSplit.id, locationId },
          data: { orderId: id },
        })

        // Recalculate parent totals from moved items (split-aware tax)
        let amInclSub = 0, amExclSub = 0
        for (const item of lastSplitItems) {
          const t = Number(item.price) * item.quantity
          if (item.isTaxInclusive) amInclSub += t; else amExclSub += t
        }
        const subtotal = amInclSub + amExclSub
        const amTax = calculateSplitTax(amInclSub, amExclSub, taxRate, autoMergeInclusiveRate)
        const total = Math.round((subtotal + amTax.taxFromExclusive) * 100) / 100

        // Restore parent order
        await OrderRepository.updateOrder(id, locationId, {
          status: 'open',
          subtotal,
          taxTotal: amTax.totalTax,
          taxFromInclusive: amTax.taxFromInclusive,
          taxFromExclusive: amTax.taxFromExclusive,
          total,
          notes: null,
        }, tx)

        // Soft delete the last split (preserve audit trail)
        await OrderRepository.updateOrder(lastSplit.id, locationId, {
          deletedAt: new Date(),
          status: 'cancelled' as OrderStatus,
        }, tx)

        // Restore any soft-deleted split items on parent
        await OrderItemRepository.updateItemsWhere(id, locationId, {
          deletedAt: { not: null },
        }, { deletedAt: null }, tx)
      })

      merged = true
    }

    // Fire-and-forget socket emit
    void emitToLocation(parentOrder.locationId, 'orders:list-changed', {
      orderId: id,
      trigger: 'split',
      tableId: parentOrder.tableId || undefined,
    }).catch(() => {})

    // Invalidate snapshot cache so open-orders summary reflects the change
    invalidateSnapshotCache(parentOrder.locationId)
    if (parentOrder.tableId) {
      void dispatchFloorPlanUpdate(parentOrder.locationId, { async: true }).catch(() => {})
    }

    // Event emission: split check deleted/cancelled
    void emitOrderEvent(parentOrder.locationId, splitId, 'ORDER_CLOSED', {
      closedStatus: 'cancelled',
      reason: merged ? 'Last split — auto-merged back to parent' : 'Empty check deleted',
    }).catch(console.error)

    // If auto-merged, parent was reopened
    if (merged) {
      void emitOrderEvent(parentOrder.locationId, id, 'ORDER_REOPENED', {
        reason: 'Last split auto-merged back to parent',
      }).catch(console.error)
    }

    if (merged) {
      return NextResponse.json({ data: {
        message: 'Last split merged back to parent',
        merged: true,
      } })
    }

    return NextResponse.json({ data: { message: 'Check deleted' } })
  } catch (error) {
    return handleApiError(error, 'Failed to delete check')
  }
})
