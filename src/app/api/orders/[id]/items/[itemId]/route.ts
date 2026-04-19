import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchOpenOrdersChanged, dispatchItemStatus, dispatchOrderTotalsUpdate, dispatchOrderSummaryUpdated, buildOrderSummary } from '@/lib/socket-dispatch'
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
  // Combo Pick N of M (Phase 5b)
  validateAndBuildComboSelections,
  ComboValidationError,
  ORDER_ITEM_FULL_INCLUDE,
  mapOrderItemForWire,
  type ComboSelectionInput,
} from '@/lib/domain/order-items'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
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
      return err('Location not found')
    }

    // Permission check: POS_ACCESS required to edit order items
    const putActor = await getActorFromRequest(request)
    const putEmployeeId = requestingEmployeeId || putActor.employeeId
    const putAuth = await requirePermission(putEmployeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!putAuth.authorized) return err(putAuth.error, putAuth.status)

    // Verify order exists (tenant-safe via OrderRepository)
    const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
      payments: {
        where: { deletedAt: null },
        select: { id: true, status: true },
      },
    })

    if (!order) {
      return notFound('Order not found')
    }

    // Fast-path guard: reject modifications on terminal order statuses and split parents
    if (['paid', 'closed', 'voided', 'split'].includes(order.status)) {
      return err('Cannot modify items on a completed or split order', 400)
    }

    // Status + payment guard via domain
    const modCheck = validateOrderModifiable(order.status, order.payments)
    if (!modCheck.valid) {
      return err(modCheck.error, modCheck.status)
    }

    // Validate quantity if provided (Bug 18)
    const qtyCheck = validateUpdateQuantity(body.quantity)
    if (!qtyCheck.valid) {
      return err(qtyCheck.error, qtyCheck.status)
    }

    // Verify item exists (tenant-safe via OrderItemRepository)
    const item = await OrderItemRepository.getItemById(itemId, locationId)

    if (!item) {
      return notFound('Item not found')
    }

    // Guard: editing a sent item (quantity/notes/price) requires elevated permission
    if (!action && item.kitchenStatus !== 'pending' && requestingEmployeeId) {
      const auth = await requirePermission(requestingEmployeeId as string, order.locationId, PERMISSIONS.MGR_EDIT_SENT_ITEMS)
      if (!auth.authorized) return err(auth.error, auth.status)
    }

    // ─── Combo Pick N of M — replace-all flow (Phase 5b) ────────────────────
    // When the client sends `comboSelections` (non-undefined), we replace the
    // entire snapshot set for this OrderItem in one transaction. Idempotency
    // is enforced via OrderItem.idempotencyKey (same store POST uses).
    const comboSelectionsField = (body as { comboSelections?: ComboSelectionInput[] | null }).comboSelections
    const comboIdempotencyKey = (body as { idempotencyKey?: string }).idempotencyKey
      || request.headers.get('idempotency-key')
      || null
    if (comboSelectionsField !== undefined) {
      try {
        const comboResult = await db.$transaction(async (tx) => {
          // Lock the OrderItem row to serialize concurrent replace-alls.
          // Using the Order row keeps parity with POST's locking pattern.
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

          // Idempotency check — if this key was already processed for this
          // order+item, short-circuit with the current state.
          if (comboIdempotencyKey) {
            const prior = await tx.orderItem.findFirst({
              where: {
                id: itemId,
                orderId,
                locationId,
                idempotencyKey: comboIdempotencyKey,
                deletedAt: null,
              },
              select: { id: true },
            })
            if (prior) {
              const currentOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
                employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
                table: { select: { id: true, name: true } },
                items: {
                  where: { deletedAt: null },
                  include: ORDER_ITEM_FULL_INCLUDE,
                },
                payments: true,
                discounts: true,
              }, tx)
              if (!currentOrder) throw new Error('Order not found')
              return { idempotent: true, updatedOrder: currentOrder, updatedItem: null as any }
            }
          }

          // Soft-delete existing combo selection rows for this OrderItem.
          await tx.orderItemComboSelection.updateMany({
            where: { orderItemId: itemId, locationId, deletedAt: null },
            data: { deletedAt: new Date() },
          })

          // Validate + build new rows. Quantity rule enforced by validator.
          const targetQuantity = body.quantity !== undefined ? Number(body.quantity) : item.quantity
          const built = await validateAndBuildComboSelections({
            prisma: tx,
            locationId,
            orderItemId: itemId,
            menuItemId: item.menuItemId,
            quantity: targetQuantity,
            selections: comboSelectionsField ?? [],
            mutationOrigin,
          })

          if (built.rowsToCreate.length > 0) {
            await tx.orderItemComboSelection.createMany({ data: built.rowsToCreate })
          }

          // Update OrderItem.price + itemTotal from server-authoritative price.
          // If validator returns null (no selections), we leave existing price alone.
          const itemUpdateData: Record<string, unknown> = {
            lastMutatedBy: mutationOrigin,
          }
          if (built.price != null) {
            itemUpdateData.price = built.price
            itemUpdateData.itemTotal = built.price
          }
          if (comboIdempotencyKey) {
            itemUpdateData.idempotencyKey = comboIdempotencyKey
          }
          await tx.orderItem.update({
            where: { id: itemId },
            data: itemUpdateData,
          })

          // Recompute order totals using the existing helper (same as POST path).
          const orderForTotals = await OrderRepository.getOrderByIdWithSelect(orderId, locationId, {
            tipTotal: true,
            isTaxExempt: true,
            location: { select: { settings: true } },
          }, tx)
          if (!orderForTotals) throw new Error('Order not found after combo update')

          const totals = await recalculateOrderTotals(
            tx as any, orderId, orderForTotals.location.settings,
            Number(orderForTotals.tipTotal) || 0, orderForTotals.isTaxExempt,
          )

          await OrderRepository.updateOrder(orderId, locationId, {
            ...totals,
            version: { increment: 1 },
            lastMutatedBy: mutationOrigin,
          }, tx)

          const updatedOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
            employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
            table: { select: { id: true, name: true } },
            items: {
              where: { deletedAt: null },
              include: ORDER_ITEM_FULL_INCLUDE,
            },
            payments: true,
            discounts: true,
          }, tx)
          if (!updatedOrder) throw new Error('Order not found after combo totals update')

          const updatedItem = (updatedOrder.items as any[]).find(i => i.id === itemId) ?? null
          return { idempotent: false, updatedOrder, updatedItem }
        })

        // Parity with POST emissions — fire-and-forget.
        void dispatchOrderTotalsUpdate(order.locationId, orderId, {
          subtotal: Number((comboResult.updatedOrder as any).subtotal),
          taxTotal: Number((comboResult.updatedOrder as any).taxTotal),
          tipTotal: Number((comboResult.updatedOrder as any).tipTotal),
          discountTotal: Number((comboResult.updatedOrder as any).discountTotal),
          total: Number((comboResult.updatedOrder as any).total),
          commissionTotal: Number((comboResult.updatedOrder as any).commissionTotal || 0),
        }, { async: true }).catch(emitErr => log.warn({ err: emitErr }, 'combo totals dispatch failed'))
        void dispatchOpenOrdersChanged(order.locationId, {
          trigger: 'item_updated',
          orderId,
        }, { async: true }).catch(emitErr => log.warn({ err: emitErr }, 'combo open-orders dispatch failed'))
        void dispatchOrderSummaryUpdated(
          order.locationId,
          buildOrderSummary(comboResult.updatedOrder as any),
          { async: true },
        ).catch(emitErr => log.warn({ err: emitErr }, 'combo summary dispatch failed'))
        void emitOrderEvent(order.locationId, orderId, 'ITEM_UPDATED', {
          lineItemId: itemId,
          comboSelectionsReplaced: true,
        }).catch(emitErr => log.warn({ err: emitErr }, 'Failed to emit ITEM_UPDATED for combo'))

        pushUpstream()

        // Response — use wire mapper so combo selections are echoed back.
        const mappedOrder = mapOrderForResponse(comboResult.updatedOrder as any)
        const itemsWithCombos = (comboResult.updatedOrder as any).items.map((it: any) => mapOrderItemForWire(it))
        return ok({ ...mappedOrder, items: itemsWithCombos })
      } catch (comboErr) {
        if (comboErr instanceof ComboValidationError) {
          return NextResponse.json(
            { error: comboErr.message, code: comboErr.code },
            { status: comboErr.status },
          )
        }
        throw comboErr
      }
    }

    // Handle actions
    if (action) {
      switch (action) {
        // Seat Tracking (Skill 11)
        case 'assign_seat':
          const seatUpdated = await OrderItemRepository.updateItemAndReturn(itemId, locationId, { seatNumber: updateData.seatNumber })
          await OrderRepository.incrementVersion(orderId, locationId)
          return ok({ success: true, item: seatUpdated })

        // Course Firing (Skill 12)
        case 'assign_course':
          const courseUpdated = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            courseNumber: updateData.courseNumber,
            courseStatus: 'pending',
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          return ok({ success: true, item: courseUpdated })

        case 'fire_course':
          // Fire this item's course (mark as fired)
          const fireUpdateData: Record<string, unknown> = {
            courseStatus: 'fired',
            firedAt: new Date(),
            isHeld: false,
          }
          // If item hasn't been sent to kitchen yet, mark it as sent when course fires
          if (item.kitchenStatus === 'pending') {
            fireUpdateData.kitchenStatus = 'sent'
          }
          const fired = await OrderItemRepository.updateItemAndReturn(itemId, locationId, fireUpdateData)

          // Also fire all other items with the same course number in this order
          if (updateData.fireAllInCourse && item.courseNumber) {
            const batchFireData: Record<string, unknown> = {
              courseStatus: 'fired',
              firedAt: new Date(),
              isHeld: false,
            }
            // Batch update: also set kitchenStatus to 'sent' for items still pending
            // Note: updateItemsWhere applies the same data to all matched rows, so we
            // handle the conditional kitchenStatus by running two updates when needed
            await OrderItemRepository.updateItemsWhere(orderId, locationId, {
              courseNumber: item.courseNumber,
              id: { not: itemId },
              kitchenStatus: 'pending',
            }, {
              ...batchFireData,
              kitchenStatus: 'sent',
            })
            // Fire items that already have a non-pending kitchenStatus (don't regress them)
            await OrderItemRepository.updateItemsWhere(orderId, locationId, {
              courseNumber: item.courseNumber,
              id: { not: itemId },
              kitchenStatus: { not: 'pending' },
            }, batchFireData)
          }

          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
          return ok({ success: true, item: fired })

        case 'mark_ready':
          // Kitchen marks item as ready
          const ready = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            courseStatus: 'ready',
            kitchenStatus: 'ready',
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
          return ok({ success: true, item: ready })

        case 'mark_served':
          // Server marks item as served
          const served = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            courseStatus: 'served',
            kitchenStatus: 'delivered',
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
          return ok({ success: true, item: served })

        // Hold & Fire (Skill 13)
        case 'hold':
          const held = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            isHeld: true,
            holdUntil: updateData.holdUntil ? new Date(updateData.holdUntil) : null,
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
          return ok({ success: true, item: held })

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
          return ok({ success: true, item: firedItem })

        case 'release':
          // Release hold without firing (item goes back to pending)
          const released = await OrderItemRepository.updateItemAndReturn(itemId, locationId, {
            isHeld: false,
            holdUntil: null,
          })
          await OrderRepository.incrementVersion(orderId, locationId)
          pushUpstream()
          return ok({ success: true, item: released })

        default:
          return err('Invalid action')
      }
    }

    // Regular update (no action specified)
    const quantityChanged = updateData.quantity !== undefined && updateData.quantity !== item.quantity

    // If quantity changed, wrap in a transaction with FOR UPDATE to prevent concurrent total drift
    if (quantityChanged) {
      const txResult = await db.$transaction(async (tx) => {
        // Row-level lock to prevent concurrent quantity updates from producing incorrect totals
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

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

        const orderForTotals = await OrderRepository.getOrderByIdWithSelect(orderId, locationId, {
          tipTotal: true,
          isTaxExempt: true,
          location: { select: { settings: true } },
        }, tx)
        if (!orderForTotals) throw new Error('Order not found after update')

        const totals = await recalculateOrderTotals(
          tx as any, orderId, orderForTotals.location.settings,
          Number(orderForTotals.tipTotal) || 0, orderForTotals.isTaxExempt
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
            include: ORDER_ITEM_FULL_INCLUDE,
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

      const qtyResponse = mapOrderForResponse(txResult)
      qtyResponse.items = (txResult as any).items.map((it: any) => mapOrderItemForWire(it)) as any
      return ok(qtyResponse)
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
    const updated = await OrderItemRepository.getItemByIdWithInclude(itemId, locationId, ORDER_ITEM_FULL_INCLUDE)
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

    return ok({
      success: true,
      item: mapOrderItemForWire(updated as any),
    })
  } catch (error) {
    console.error('Failed to update order item:', error)
    return err('Failed to update order item', 500)
  }
})

// DELETE - Remove an order item (only if not yet sent to kitchen)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: orderId, itemId } = await params
    const body = await request.json().catch(() => ({}))
    const { reason, managerApprovalEmployeeId } = body as { reason?: string; managerApprovalEmployeeId?: string }

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularDelete = request.headers.get('x-cellular-authenticated') === '1'
    const deleteMutationOrigin = isCellularDelete ? 'cloud' : 'local'

    // Resolve locationId for tenant-safe queries
    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location not found')
    }

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent deletes from producing incorrect totals
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

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
        return notFound('Order not found')
      }

      // Fast-path guard: reject deletions on split parents (modify children instead)
      if (order.status === 'split') {
        return err('Cannot delete items on a split order', 400)
      }

      // Status + payment guard via domain
      const modCheck = validateOrderModifiable(order.status, order.payments)
      if (!modCheck.valid) {
        return err(modCheck.error, modCheck.status)
      }

      // Verify item exists and belongs to this order (tenant-safe via OrderItemRepository)
      const item = await OrderItemRepository.getItemByIdWithInclude(itemId, locationId, {
        menuItem: { select: { name: true } },
      }, tx)

      if (!item) {
        return notFound('Item not found')
      }

      // Permission check — require POS access to delete items
      const deleteActor = await getActorFromRequest(request)
      const employeeId = request.nextUrl.searchParams.get('employeeId') || deleteActor.employeeId
      const deleteAuth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
      if (!deleteAuth.authorized) return err(deleteAuth.error, deleteAuth.status)

      // Check if item was already sent to kitchen
      const wasSentToKitchen = item.kitchenStatus !== 'pending' && item.kitchenStatus !== null

      // Validate item is deletable (pending kitchen status, active status) via domain
      const delCheck = validateItemDeletable(item)
      if (!delCheck.valid) {
        // Item has been sent to kitchen — require manager void permission to delete
        const voidAuth = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_VOID_ITEMS)
        if (!voidAuth.authorized) {
          return NextResponse.json({
            error: 'Manager approval required to remove items already sent to kitchen',
            code: 'REQUIRES_MANAGER_VOID',
          }, { status: 403 })
        }
        // Manager with void permission — allow deletion of sent item
        // If item was sent to kitchen and no reason provided, return 400
        if (!reason || reason.trim().length === 0) {
          return err('Reason is required to remove items already sent to kitchen', 400)
        }
      }

      // W4-3: Audit log for item deletion before send (fire-and-forget)
      void tx.auditLog.create({
        data: {
          locationId: order.locationId,
          employeeId,
          action: item.kitchenStatus !== 'pending' ? 'item_removed_after_send' : 'item_removed_before_send',
          entityType: 'order',
          entityId: orderId,
          details: {
            itemId: item.id,
            menuItemName: item.menuItem?.name || item.name,
            quantity: item.quantity,
            amount: Number(item.itemTotal),
            sentToKitchen: item.kitchenStatus !== 'pending',
            reason: reason || null,
            managerApprovalEmployeeId: managerApprovalEmployeeId || null,
          },
        },
      }).catch(err => console.error('[AuditLog] Failed to log item removal:', err))

      // Soft delete modifiers and the item via domain
      await softDeleteOrderItem(tx, itemId)

      console.log(`[AUDIT] ORDER_ITEM_DELETED: orderId=${orderId}, itemId=${itemId}, itemName="${item.menuItem?.name || item.name}", qty=${item.quantity}, amount=$${Number(item.itemTotal)}, by employee ${employeeId}, reason: "${reason || 'none'}", managerApproval: ${managerApprovalEmployeeId || 'none'}`)

      // Emit ITEM_REMOVED event with reason tracking (fire-and-forget)
      void emitOrderEvent(order.locationId, orderId, 'ITEM_REMOVED', {
        lineItemId: itemId,
        reason: reason || null,
        managerApprovalEmployeeId: managerApprovalEmployeeId || null,
        removedAfterSend: wasSentToKitchen,
      })

      // Recalculate totals from remaining active items via domain (tenant-safe)
      const orderForTotals = await OrderRepository.getOrderByIdWithSelect(orderId, locationId, {
        tipTotal: true,
        isTaxExempt: true,
        location: { select: { settings: true } },
      }, tx)
      if (!orderForTotals) throw new Error('Order not found after soft delete')

      const totals = await recalculateOrderTotals(
        tx, orderId, orderForTotals.location.settings,
        Number(orderForTotals.tipTotal) || 0, orderForTotals.isTaxExempt
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
          include: ORDER_ITEM_FULL_INCLUDE,
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

      const deleteResponse = mapOrderForResponse(updatedOrder as any)
      deleteResponse.items = (updatedOrder as any).items.map((it: any) => mapOrderItemForWire(it)) as any
      return ok(deleteResponse)
    })

    pushUpstream()

    return result
  } catch (error) {
    console.error('Failed to delete order item:', error)
    return err('Failed to delete order item', 500)
  }
})
