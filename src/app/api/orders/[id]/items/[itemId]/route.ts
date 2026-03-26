import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchOpenOrdersChanged, dispatchItemStatus } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { mapOrderForResponse } from '@/lib/api/order-response-mapper'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { getLocationId } from '@/lib/location-cache'
import {
  validateOrderModifiable,
  validateUpdateQuantity,
  validateItemDeletable,
  fetchLiveModifierTotal,
  calculateUpdatedItemTotal,
  softDeleteOrderItem,
  recalculateOrderTotals,
} from '@/lib/domain/order-items'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('orders-items')

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

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularItemUpdate = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularItemUpdate ? 'cloud' : 'local'

    // Resolve locationId for tenant-safe queries
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    // Permission check: POS_ACCESS required to edit order items
    const putActor = await getActorFromRequest(request)
    const putEmployeeId = requestingEmployeeId || putActor.employeeId
    const putAuth = await requirePermission(putEmployeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!putAuth.authorized) return NextResponse.json({ error: putAuth.error }, { status: putAuth.status })

    // Verify order exists (tenant-safe via OrderRepository)
    const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
      payments: {
        where: { deletedAt: null },
        select: { id: true, status: true },
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

    // Verify item exists (tenant-safe via OrderItemRepository)
    const item = await OrderItemRepository.getItemById(itemId, locationId)

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
          const seatUpdated = await OrderItemRepository.updateItemAndReturn(itemId, locationId, { seatNumber: updateData.seatNumber })
          await OrderRepository.incrementVersion(orderId, locationId)
          return NextResponse.json({ data: { success: true, item: seatUpdated } })

        // Course Firing (Skill 12)
        case 'assign_course':
          const courseUpdated = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            courseNumber: updateData.courseNumber,
            courseStatus: 'pending',
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          return NextResponse.json({ data: { success: true, item: courseUpdated } })

        case 'fire_course':
          // Fire this item's course (mark as fired)
          const fired = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            courseStatus: 'fired',
            firedAt: new Date(),
            isHeld: false,
          })

          // Also fire all other items with the same course number in this order
          if (updateData.fireAllInCourse && item.courseNumber) {
            await OrderItemRepository.updateItemsWhere(orderId, locationId, {
              courseNumber: item.courseNumber,
              id: { not: itemId },
            }, {
              courseStatus: 'fired',
              firedAt: new Date(),
              isHeld: false,
            })
          }

          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
          return NextResponse.json({ data: { success: true, item: fired } })

        case 'mark_ready':
          // Kitchen marks item as ready
          const ready = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            courseStatus: 'ready',
            kitchenStatus: 'ready',
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
          return NextResponse.json({ data: { success: true, item: ready } })

        case 'mark_served':
          // Server marks item as served
          const served = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            courseStatus: 'served',
            kitchenStatus: 'delivered',
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
          return NextResponse.json({ data: { success: true, item: served } })

        // Hold & Fire (Skill 13)
        case 'hold':
          const held = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            isHeld: true,
            holdUntil: updateData.holdUntil ? new Date(updateData.holdUntil) : null,
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
          return NextResponse.json({ data: { success: true, item: held } })

        case 'fire':
          // Fire a held item immediately
          const firedItem = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            isHeld: false,
            holdUntil: null,
            firedAt: new Date(),
            courseStatus: item.courseNumber ? 'fired' : item.courseStatus,
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
          return NextResponse.json({ data: { success: true, item: firedItem } })

        case 'release':
          // Release hold without firing (item goes back to pending)
          const released = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            isHeld: false,
            holdUntil: null,
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
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

    // If quantity changed, wrap in a transaction with FOR UPDATE to prevent concurrent total drift
    if (quantityChanged) {
      const txResult = await db.$transaction(async (tx) => {
        // Row-level lock to prevent concurrent quantity updates from producing incorrect totals
        await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

        // Fetch active modifiers for fresh modifierTotal (stale item.modifierTotal can cause penny drift)
        const liveModifierTotal = await fetchLiveModifierTotal(tx as any, itemId)

        // Update the item (tenant-safe write) then read-back with modifiers
        await OrderItemRepository.updateItem(itemId, locationId, {
          seatNumber: updateData.seatNumber !== undefined ? updateData.seatNumber : undefined,
          courseNumber: updateData.courseNumber !== undefined ? updateData.courseNumber : undefined,
          courseStatus: updateData.courseStatus,
          isHeld: updateData.isHeld !== undefined ? updateData.isHeld : undefined,
          holdUntil: updateData.holdUntil ? new Date(updateData.holdUntil) : undefined,
          specialNotes: updateData.specialNotes,
          quantity: updateData.quantity,
          modifierTotal: liveModifierTotal,
          itemTotal: calculateUpdatedItemTotal(Number(item.price), liveModifierTotal, updateData.quantity),
        }, tx)

        const fullOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
          location: { select: { settings: true } },
        }, tx)
        if (!fullOrder) throw new Error('Order not found after update')

        const totals = await recalculateOrderTotals(
          tx as any, orderId, fullOrder.location.settings,
          Number(fullOrder.tipTotal) || 0, fullOrder.isTaxExempt
        )

        await OrderRepository.updateOrder(orderId, locationId, {
          ...totals,
          version: { increment: 1 },
          lastMutatedBy: mutationOrigin,
        }, tx)

        // Return full order response so clients get updated totals
        const updatedOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
          items: {
            where: { deletedAt: null },
            include: { modifiers: { where: { deletedAt: null } } },
          },
          employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
          table: { select: { id: true, name: true } },
          payments: true,
          discounts: true,
        }, tx)
        if (!updatedOrder) throw new Error('Order not found after totals update')

        return updatedOrder
      })

      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'item_updated',
        orderId: order.id,
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId'))
      if (item.kitchenStatus && item.kitchenStatus !== 'pending') {
        void dispatchItemStatus(order.locationId, {
          orderId,
          itemId,
          status: item.kitchenStatus,
          stationId: '',
          updatedBy: 'system',
        }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
      }

      // Emit ITEM_UPDATED event for quantity change (fire-and-forget)
      void emitOrderEvent(order.locationId, orderId, 'ITEM_UPDATED', {
        lineItemId: itemId,
        quantity: updateData.quantity,
      })

      pushUpstream()

      return NextResponse.json({ data: mapOrderForResponse(txResult) })
    }

    // Non-quantity update (no total recalculation needed, no lock required)
    // Fetch active modifiers for fresh modifierTotal (stale item.modifierTotal can cause penny drift)
    const liveModifierTotal = Number(item.modifierTotal)

    // Update the item (tenant-safe write) then read-back with modifiers
    await OrderItemRepository.updateItem(itemId, locationId, {
      seatNumber: updateData.seatNumber !== undefined ? updateData.seatNumber : undefined,
      courseNumber: updateData.courseNumber !== undefined ? updateData.courseNumber : undefined,
      courseStatus: updateData.courseStatus,
      isHeld: updateData.isHeld !== undefined ? updateData.isHeld : undefined,
      holdUntil: updateData.holdUntil ? new Date(updateData.holdUntil) : undefined,
      specialNotes: updateData.specialNotes,
    })
    const updated = await OrderItemRepository.getItemByIdWithInclude(itemId, locationId, {
      modifiers: { where: { deletedAt: null } },
    })
    if (!updated) throw new Error('OrderItem not found after update')

    // Emit ITEM_UPDATED event with only changed fields (fire-and-forget)
    const itemUpdatedPayload: Record<string, unknown> = { lineItemId: itemId }
    if (updateData.isHeld !== undefined) itemUpdatedPayload.isHeld = updateData.isHeld
    if (updateData.specialNotes !== undefined) itemUpdatedPayload.specialNotes = updateData.specialNotes
    if (updateData.courseNumber !== undefined) itemUpdatedPayload.courseNumber = updateData.courseNumber
    if (updateData.seatNumber !== undefined) itemUpdatedPayload.seatNumber = updateData.seatNumber
    if (updateData.courseStatus !== undefined) itemUpdatedPayload.kitchenStatus = updateData.courseStatus
    void emitOrderEvent(order.locationId, orderId, 'ITEM_UPDATED', itemUpdatedPayload)

    await OrderRepository.incrementVersion(orderId, locationId)

    // If item has already been sent to kitchen, notify KDS so it refetches
    if (updated.kitchenStatus && updated.kitchenStatus !== 'pending') {
      void dispatchItemStatus(order.locationId, {
        orderId,
        itemId,
        status: updated.kitchenStatus,
        stationId: '',
        updatedBy: 'system',
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    pushUpstream()

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

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularDelete = request.headers.get('x-cellular-authenticated') === '1'
    const deleteMutationOrigin = isCellularDelete ? 'cloud' : 'local'

    // Resolve locationId for tenant-safe queries
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent deletes from producing incorrect totals
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      // Verify order exists and is in a deletable state (tenant-safe via OrderRepository)
      const order = await OrderRepository.getOrderByIdWithSelect(orderId, locationId, {
        id: true,
        status: true,
        locationId: true,
        payments: {
          where: { deletedAt: null },
          select: { id: true, status: true },
        },
      }, tx)

      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      // Status + payment guard via domain
      const modCheck = validateOrderModifiable(order.status, order.payments)
      if (!modCheck.valid) {
        return NextResponse.json({ error: modCheck.error }, { status: modCheck.status })
      }

      // Verify item exists and belongs to this order (tenant-safe via OrderItemRepository)
      const item = await OrderItemRepository.getItemByIdWithInclude(itemId, locationId, {
        menuItem: { select: { name: true } },
      }, tx)

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Validate item is deletable (pending kitchen status, active status) via domain
      const delCheck = validateItemDeletable(item)
      if (!delCheck.valid) {
        return NextResponse.json({ error: delCheck.error }, { status: delCheck.status })
      }

      // Permission check — require POS access to delete items
      const deleteActor = await getActorFromRequest(request)
      const employeeId = request.nextUrl.searchParams.get('employeeId') || deleteActor.employeeId
      const deleteAuth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
      if (!deleteAuth.authorized) return NextResponse.json({ error: deleteAuth.error }, { status: deleteAuth.status })

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

      // Recalculate totals from remaining active items via domain (tenant-safe)
      const fullOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
        location: { select: { settings: true } },
      }, tx)
      if (!fullOrder) throw new Error('Order not found after soft delete')

      const totals = await recalculateOrderTotals(
        tx, orderId, fullOrder.location.settings,
        Number(fullOrder.tipTotal) || 0, fullOrder.isTaxExempt
      )

      await OrderRepository.updateOrder(orderId, locationId, {
        ...totals,
        version: { increment: 1 },
        lastMutatedBy: deleteMutationOrigin,
      }, tx)

      // Fetch updated order with items for response (tenant-safe)
      const updatedOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
        items: {
          where: { deletedAt: null },
          include: { modifiers: { where: { deletedAt: null } } },
        },
        employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
        table: { select: { id: true, name: true } },
        payments: true,
        discounts: true,
      }, tx)
      if (!updatedOrder) throw new Error('Order not found after totals update')

      // Dispatch socket event so other terminals see the removal (Bug 11)
      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'voided',
        orderId: order.id,
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId'))

      return NextResponse.json({ data: mapOrderForResponse(updatedOrder) })
    })

    pushUpstream()

    return result
  } catch (error) {
    console.error('Failed to delete order item:', error)
    return NextResponse.json(
      { error: 'Failed to delete order item' },
      { status: 500 }
    )
  }
})
