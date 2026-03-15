import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchOpenOrdersChanged, dispatchItemStatus } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { mapOrderForResponse } from '@/lib/api/order-response-mapper'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import {
  validateOrderModifiable,
  validateUpdateQuantity,
  validateItemDeletable,
  fetchLiveModifierTotal,
  calculateUpdatedItemTotal,
  softDeleteOrderItem,
  recalculateOrderTotals,
} from '@/lib/domain/order-items'

// PUT - Update an order item (seat, course, hold status, kitchen status, etc.)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: orderId, itemId } = await params
    const body = await request.json()
    const { action, ...updateData } = body
    const requestingEmployeeId = (body as { requestingEmployeeId?: string }).requestingEmployeeId

    // Verify order exists
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        payments: {
          where: { deletedAt: null },
          select: { id: true, status: true },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Status + payment guard via domain
    const modCheck = validateOrderModifiable(order.status, order.payments)
    if (!modCheck.valid) {
      return NextResponse.json({ error: modCheck.error }, { status: modCheck.status })
    }

    // Validate quantity if provided (Bug 18)
    const qtyCheck = validateUpdateQuantity(body.quantity)
    if (!qtyCheck.valid) {
      return NextResponse.json({ error: qtyCheck.error }, { status: qtyCheck.status })
    }

    // Verify item exists
    const item = await db.orderItem.findFirst({
      where: { id: itemId, orderId },
    })

    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }

    // Guard: editing a sent item (quantity/notes/price) requires elevated permission
    if (!action && item.kitchenStatus !== 'pending' && requestingEmployeeId) {
      const auth = await requirePermission(requestingEmployeeId as string, order.locationId, PERMISSIONS.MGR_EDIT_SENT_ITEMS)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Handle actions
    if (action) {
      switch (action) {
        // Seat Tracking (Skill 11)
        case 'assign_seat':
          const seatUpdated = await db.orderItem.update({
            where: { id: itemId },
            data: { seatNumber: updateData.seatNumber },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: seatUpdated } })

        // Course Firing (Skill 12)
        case 'assign_course':
          const courseUpdated = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseNumber: updateData.courseNumber,
              courseStatus: 'pending',
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: courseUpdated } })

        case 'fire_course':
          // Fire this item's course (mark as fired)
          const fired = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseStatus: 'fired',
              firedAt: new Date(),
              isHeld: false,
            },
          })

          // Also fire all other items with the same course number in this order
          if (updateData.fireAllInCourse && item.courseNumber) {
            await db.orderItem.updateMany({
              where: {
                orderId,
                courseNumber: item.courseNumber,
                id: { not: itemId },
              },
              data: {
                courseStatus: 'fired',
                firedAt: new Date(),
                isHeld: false,
              },
            })
          }

          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: fired } })

        case 'mark_ready':
          // Kitchen marks item as ready
          const ready = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseStatus: 'ready',
              kitchenStatus: 'ready',
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: ready } })

        case 'mark_served':
          // Server marks item as served
          const served = await db.orderItem.update({
            where: { id: itemId },
            data: {
              courseStatus: 'served',
              kitchenStatus: 'delivered',
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: served } })

        // Hold & Fire (Skill 13)
        case 'hold':
          const held = await db.orderItem.update({
            where: { id: itemId },
            data: {
              isHeld: true,
              holdUntil: updateData.holdUntil ? new Date(updateData.holdUntil) : null,
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: held } })

        case 'fire':
          // Fire a held item immediately
          const firedItem = await db.orderItem.update({
            where: { id: itemId },
            data: {
              isHeld: false,
              holdUntil: null,
              firedAt: new Date(),
              courseStatus: item.courseNumber ? 'fired' : item.courseStatus,
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: firedItem } })

        case 'release':
          // Release hold without firing (item goes back to pending)
          const released = await db.orderItem.update({
            where: { id: itemId },
            data: {
              isHeld: false,
              holdUntil: null,
            },
          })
          await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })
          return NextResponse.json({ data: { success: true, item: released } })

        default:
          return NextResponse.json(
            { error: 'Invalid action' },
            { status: 400 }
          )
      }
    }

    // Regular update (no action specified)
    const quantityChanged = updateData.quantity !== undefined && updateData.quantity !== item.quantity

    // Fetch active modifiers for fresh modifierTotal (stale item.modifierTotal can cause penny drift)
    let liveModifierTotal = Number(item.modifierTotal)
    if (quantityChanged) {
      liveModifierTotal = await fetchLiveModifierTotal(db as any, itemId)
    }

    const updated = await db.orderItem.update({
      where: { id: itemId },
      data: {
        seatNumber: updateData.seatNumber !== undefined ? updateData.seatNumber : undefined,
        courseNumber: updateData.courseNumber !== undefined ? updateData.courseNumber : undefined,
        courseStatus: updateData.courseStatus,
        isHeld: updateData.isHeld !== undefined ? updateData.isHeld : undefined,
        holdUntil: updateData.holdUntil ? new Date(updateData.holdUntil) : undefined,
        specialNotes: updateData.specialNotes,
        ...(quantityChanged ? {
          quantity: updateData.quantity,
          modifierTotal: liveModifierTotal,
          itemTotal: calculateUpdatedItemTotal(Number(item.price), liveModifierTotal, updateData.quantity),
        } : {}),
      },
      include: { modifiers: true },
    })

    // If quantity changed, recalculate order totals via domain
    if (quantityChanged) {
      const fullOrder = await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          location: { select: { settings: true } },
        },
      })

      const totals = await recalculateOrderTotals(
        db as any, orderId, fullOrder.location.settings,
        Number(fullOrder.tipTotal) || 0, fullOrder.isTaxExempt
      )

      await db.order.update({
        where: { id: orderId },
        data: {
          ...totals,
          version: { increment: 1 },
        },
      })

      // Return full order response so clients get updated totals
      const updatedOrder = await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: {
            where: { deletedAt: null },
            include: { modifiers: { where: { deletedAt: null } } },
          },
          employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
          table: { select: { id: true, name: true } },
          payments: true,
          discounts: true,
        },
      })

      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'item_updated',
        orderId: order.id,
      }).catch(() => {})

      // If item has already been sent to kitchen, notify KDS so it refetches
      if (item.kitchenStatus && item.kitchenStatus !== 'pending') {
        void dispatchItemStatus(order.locationId, {
          orderId,
          itemId,
          status: item.kitchenStatus,
          stationId: '',
          updatedBy: 'system',
        }, { async: true }).catch(console.error)
      }

      // Emit ITEM_UPDATED event for quantity change (fire-and-forget)
      void emitOrderEvent(order.locationId, orderId, 'ITEM_UPDATED', {
        lineItemId: itemId,
        quantity: updateData.quantity,
      })

      return NextResponse.json({ data: mapOrderForResponse(updatedOrder) })
    }

    // Emit ITEM_UPDATED event with only changed fields (fire-and-forget)
    const itemUpdatedPayload: Record<string, unknown> = { lineItemId: itemId }
    if (updateData.isHeld !== undefined) itemUpdatedPayload.isHeld = updateData.isHeld
    if (updateData.specialNotes !== undefined) itemUpdatedPayload.specialNotes = updateData.specialNotes
    if (updateData.courseNumber !== undefined) itemUpdatedPayload.courseNumber = updateData.courseNumber
    if (updateData.seatNumber !== undefined) itemUpdatedPayload.seatNumber = updateData.seatNumber
    if (updateData.courseStatus !== undefined) itemUpdatedPayload.kitchenStatus = updateData.courseStatus
    void emitOrderEvent(order.locationId, orderId, 'ITEM_UPDATED', itemUpdatedPayload)

    await db.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } })

    // If item has already been sent to kitchen, notify KDS so it refetches
    if (updated.kitchenStatus && updated.kitchenStatus !== 'pending') {
      void dispatchItemStatus(order.locationId, {
        orderId,
        itemId,
        status: updated.kitchenStatus,
        stationId: '',
        updatedBy: 'system',
      }, { async: true }).catch(console.error)
    }

    return NextResponse.json({ data: {
      success: true,
      item: {
        ...updated,
        price: Number(updated.price),
        modifierTotal: Number(updated.modifierTotal),
        itemTotal: Number(updated.itemTotal),
        modifiers: updated.modifiers.map(m => ({
          ...m,
          price: Number(m.price),
        })),
      },
    } })
  } catch (error) {
    console.error('Failed to update order item:', error)
    return NextResponse.json(
      { error: 'Failed to update order item' },
      { status: 500 }
    )
  }
})

// DELETE - Remove an order item (only if not yet sent to kitchen)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: orderId, itemId } = await params

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent deletes from producing incorrect totals
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      // Verify order exists and is in a deletable state
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          locationId: true,
          payments: {
            where: { deletedAt: null },
            select: { id: true, status: true },
          },
        },
      })

      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      // Status + payment guard via domain
      const modCheck = validateOrderModifiable(order.status, order.payments)
      if (!modCheck.valid) {
        return NextResponse.json({ error: modCheck.error }, { status: modCheck.status })
      }

      // Verify item exists and belongs to this order
      const item = await tx.orderItem.findFirst({
        where: { id: itemId, orderId },
        include: { menuItem: { select: { name: true } } },
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Validate item is deletable (pending kitchen status, active status) via domain
      const delCheck = validateItemDeletable(item)
      if (!delCheck.valid) {
        return NextResponse.json({ error: delCheck.error }, { status: delCheck.status })
      }

      // Permission check — require POS access to delete items
      const employeeId = request.nextUrl.searchParams.get('employeeId') || null
      if (employeeId) {
        const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
        if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
      }

      // W4-3: Audit log for item deletion before send (fire-and-forget)
      void tx.auditLog.create({
        data: {
          locationId: order.locationId,
          employeeId,
          action: 'item_removed_before_send',
          entityType: 'order',
          entityId: orderId,
          details: {
            itemId: item.id,
            menuItemName: item.menuItem?.name || item.name,
            quantity: item.quantity,
            amount: Number(item.itemTotal),
            sentToKitchen: false,
          },
        },
      }).catch(err => console.error('[AuditLog] Failed to log item removal:', err))

      // Soft delete modifiers and the item via domain
      await softDeleteOrderItem(tx, itemId)

      console.log(`[AUDIT] ORDER_ITEM_DELETED: orderId=${orderId}, itemId=${itemId}, itemName="${item.menuItem?.name || item.name}", qty=${item.quantity}, amount=$${Number(item.itemTotal)}, by employee ${employeeId}`)

      // Emit ITEM_REMOVED event (fire-and-forget)
      void emitOrderEvent(order.locationId, orderId, 'ITEM_REMOVED', {
        lineItemId: itemId,
      })

      // Recalculate totals from remaining active items via domain
      const fullOrder = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          location: { select: { settings: true } },
        },
      })

      const totals = await recalculateOrderTotals(
        tx, orderId, fullOrder.location.settings,
        Number(fullOrder.tipTotal) || 0, fullOrder.isTaxExempt
      )

      await tx.order.update({
        where: { id: orderId },
        data: {
          ...totals,
          version: { increment: 1 },
        },
      })

      // Fetch updated order with items for response
      const updatedOrder = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: {
            where: { deletedAt: null },
            include: { modifiers: { where: { deletedAt: null } } },
          },
          employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
          table: { select: { id: true, name: true } },
          payments: true,
          discounts: true,
        },
      })

      // Dispatch socket event so other terminals see the removal (Bug 11)
      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'voided',
        orderId: order.id,
      }).catch(() => {})

      return NextResponse.json({ data: mapOrderForResponse(updatedOrder) })
    })

    return result
  } catch (error) {
    console.error('Failed to delete order item:', error)
    return NextResponse.json(
      { error: 'Failed to delete order item' },
      { status: 500 }
    )
  }
})
