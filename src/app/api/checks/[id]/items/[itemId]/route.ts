import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitCheckEventInTx, checkIdempotency, validateLease, isLeaseError, resolveLocationId } from '@/lib/check-events'
import { emitToLocation } from '@/lib/socket-server'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { err, ok, notFound } from '@/lib/api-response'

// ── Zod schema for DELETE /api/checks/[id]/items/[itemId] ───────────
const RemoveItemSchema = z.object({
  commandId: z.string().uuid('commandId must be a UUID'),
  terminalId: z.string().min(1, 'terminalId is required'),
  reason: z.string().optional(),
})

// ── Zod schema for PATCH /api/checks/[id]/items/[itemId] ────────────
const UpdateItemSchema = z.object({
  commandId: z.string().uuid('commandId must be a UUID'),
  terminalId: z.string().min(1, 'terminalId is required'),
  quantity: z.number().int().min(1).optional(),
  priceCents: z.number().int().optional(),
  name: z.string().min(1).optional(),
  modifiers: z.array(z.record(z.string(), z.unknown())).optional(),
  specialNotes: z.string().nullable().optional(),
  seatNumber: z.number().int().nullable().optional(),
  courseNumber: z.number().int().nullable().optional(),
  isHeld: z.boolean().optional(),
  status: z.enum(['active', 'voided', 'comped', 'removed']).optional(),
  delayMinutes: z.number().int().nullable().optional(),
  blockTimeMinutes: z.number().int().nullable().optional(),
  itemType: z.string().nullable().optional(),
})

type RouteParams = { params: Promise<{ id: string; itemId: string }> }

// DELETE /api/checks/[id]/items/[itemId]
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: checkId, itemId } = await params
    const rawBody = await request.json()
    const parseResult = RemoveItemSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data

    // Resolve locationId
    const locationId = await resolveLocationId(request)
    if (!locationId) return err('locationId is required', 400)

    // Auth
    const actor = await getActorFromRequest(request)
    if (actor.employeeId) {
      const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
      if (!auth.authorized) return err(auth.error, auth.status)
    }

    // Idempotency
    const existing = await checkIdempotency(body.commandId)
    if (existing) return ok(existing)

    // Validate lease — allow both draft and committed checks
    const leaseResult = await validateLease(checkId, body.terminalId, locationId, {
      allowStatuses: ['draft', 'committed'],
    })
    if (isLeaseError(leaseResult)) return leaseResult.response
    const check = leaseResult.check

    // Verify item exists on this check
    const item = await db.checkItem.findFirst({
      where: { id: itemId, checkId, status: 'active' },
    })
    if (!item) return notFound('Item not found on this check')

    // Remove item + emit event + record command in one transaction
    const deleteResult = { id: itemId, status: 'removed' }
    const removePayload = { lineItemId: itemId, reason: body.reason ?? null }
    const isCommitted = check.orderId && check.status !== 'draft'

    const eventResult = await db.$transaction(async (tx) => {
      await tx.checkItem.update({
        where: { id: itemId },
        data: { status: 'removed' },
      })

      // Dual-write: update linked OrderItem when committed
      if (isCommitted) {
        await tx.orderItem.update({
          where: { id: itemId },
          data: { status: 'removed' },
        })
      }

      await tx.check.update({ where: { id: checkId }, data: { updatedAt: new Date() } })

      const evResult = await emitCheckEventInTx(tx, locationId, checkId, 'CHECK_ITEM_REMOVED', removePayload, { commandId: body.commandId })

      await tx.processedCommand.create({
        data: {
          commandId: body.commandId,
          resultJson: JSON.stringify(deleteResult),
        },
      })

      return evResult
    })

    // Broadcast check:event after txn commits — fire-and-forget
    void emitToLocation(locationId, 'check:event', {
      eventId: eventResult.eventId,
      checkId,
      serverSequence: eventResult.serverSequence,
      type: 'CHECK_ITEM_REMOVED',
      payload: removePayload,
      commandId: body.commandId,
      deviceId: body.terminalId,
    }).catch(console.error)

    // If committed, also emit order events for terminals listening to order changes
    if (isCommitted) {
      void emitOrderEvent(locationId, check.orderId as string, 'ITEM_REMOVED', {
        lineItemId: itemId,
        reason: body.reason ?? null,
      }).catch(console.error)
      void dispatchOpenOrdersChanged(locationId, {
        trigger: 'item_updated',
        orderId: check.orderId as string,
      }).catch(console.error)
    }

    return ok(deleteResult)
  } catch (error) {
    console.error('Failed to remove check item:', error)
    return err('Failed to remove check item', 500)
  }
})

// PATCH /api/checks/[id]/items/[itemId]
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: checkId, itemId } = await params
    const rawBody = await request.json()
    const parseResult = UpdateItemSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data

    // Resolve locationId
    const locationId = await resolveLocationId(request)
    if (!locationId) return err('locationId is required', 400)

    // Auth
    const actor = await getActorFromRequest(request)
    if (actor.employeeId) {
      const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
      if (!auth.authorized) return err(auth.error, auth.status)
    }

    // Idempotency
    const existing = await checkIdempotency(body.commandId)
    if (existing) return ok(existing)

    // Validate lease — allow both draft and committed checks
    const leaseResult = await validateLease(checkId, body.terminalId, locationId, {
      allowStatuses: ['draft', 'committed'],
    })
    if (isLeaseError(leaseResult)) return leaseResult.response
    const check = leaseResult.check

    // Verify item exists
    const item = await db.checkItem.findFirst({
      where: { id: itemId, checkId, status: 'active' },
    })
    if (!item) return notFound('Item not found on this check')

    // Build update data (only provided fields)
    const { commandId, terminalId, ...updateFields } = body
    const updateData: Record<string, unknown> = {}
    if (updateFields.quantity !== undefined) updateData.quantity = updateFields.quantity
    if (updateFields.priceCents !== undefined) updateData.priceCents = updateFields.priceCents
    if (updateFields.name !== undefined) updateData.name = updateFields.name
    if (updateFields.modifiers !== undefined) updateData.modifiersJson = JSON.stringify(updateFields.modifiers)
    if (updateFields.specialNotes !== undefined) updateData.specialNotes = updateFields.specialNotes
    if (updateFields.seatNumber !== undefined) updateData.seatNumber = updateFields.seatNumber
    if (updateFields.courseNumber !== undefined) updateData.courseNumber = updateFields.courseNumber
    if (updateFields.isHeld !== undefined) updateData.isHeld = updateFields.isHeld
    if (updateFields.status !== undefined) updateData.status = updateFields.status
    if (updateFields.delayMinutes !== undefined) updateData.delayMinutes = updateFields.delayMinutes
    if (updateFields.blockTimeMinutes !== undefined) updateData.blockTimeMinutes = updateFields.blockTimeMinutes
    if (updateFields.itemType !== undefined) updateData.itemType = updateFields.itemType

    const isCommitted = check.orderId && check.status !== 'draft'

    // Update item + emit event + record command in one transaction
    const updatePayload = { lineItemId: itemId, ...updateFields }
    const result = await db.$transaction(async (tx) => {
      const updatedItem = await tx.checkItem.update({
        where: { id: itemId },
        data: updateData,
      })

      // Dual-write: update linked OrderItem when committed
      if (isCommitted) {
        const orderUpdateData: Record<string, unknown> = {}
        if (updateFields.quantity !== undefined) orderUpdateData.quantity = updateFields.quantity
        if (updateFields.priceCents !== undefined) orderUpdateData.price = updateFields.priceCents / 100
        if (updateFields.name !== undefined) orderUpdateData.name = updateFields.name
        if (updateFields.specialNotes !== undefined) orderUpdateData.specialNotes = updateFields.specialNotes
        if (updateFields.seatNumber !== undefined) orderUpdateData.seatNumber = updateFields.seatNumber
        if (updateFields.courseNumber !== undefined) orderUpdateData.courseNumber = updateFields.courseNumber
        if (updateFields.isHeld !== undefined) orderUpdateData.isHeld = updateFields.isHeld
        if (updateFields.status !== undefined) orderUpdateData.status = updateFields.status
        if (updateFields.delayMinutes !== undefined) orderUpdateData.delayMinutes = updateFields.delayMinutes
        if (updateFields.blockTimeMinutes !== undefined) orderUpdateData.blockTimeMinutes = updateFields.blockTimeMinutes

        // Recalculate itemTotal if price or quantity changed
        const newPrice = updateFields.priceCents !== undefined ? updateFields.priceCents / 100 : Number(item.priceCents) / 100
        const newQty = updateFields.quantity !== undefined ? updateFields.quantity : item.quantity
        if (updateFields.priceCents !== undefined || updateFields.quantity !== undefined) {
          orderUpdateData.itemTotal = newPrice * newQty
        }

        await tx.orderItem.update({
          where: { id: itemId },
          data: orderUpdateData,
        })

        // If modifiers changed, replace OrderItemModifier records
        if (updateFields.modifiers !== undefined) {
          await tx.orderItemModifier.deleteMany({ where: { orderItemId: itemId } })
          if (updateFields.modifiers && updateFields.modifiers.length > 0) {
            await tx.orderItemModifier.createMany({
              data: updateFields.modifiers.map((mod: Record<string, unknown>) => ({
                orderItemId: itemId,
                locationId: check.locationId,
                modifierId: (mod.modifierId as string) || null,
                name: mod.name as string,
                price: mod.price as number,
                quantity: (mod.quantity as number) ?? 1,
                preModifier: (mod.preModifier as string) || null,
                depth: (mod.depth as number) ?? 0,
                spiritTier: (mod.spiritTier as string) || null,
                linkedBottleProductId: (mod.linkedBottleProductId as string) || null,
                isCustomEntry: (mod.isCustomEntry as boolean) || false,
                isNoneSelection: (mod.isNoneSelection as boolean) || false,
                swapTargetName: (mod.swapTargetName as string) || null,
                swapTargetItemId: (mod.swapTargetItemId as string) || null,
                swapPricingMode: (mod.swapPricingMode as string) || null,
                swapEffectivePrice: (mod.swapEffectivePrice as number) ?? null,
              })),
            })
          }
        }
      }

      await tx.check.update({ where: { id: checkId }, data: { updatedAt: new Date() } })

      const eventResult = await emitCheckEventInTx(tx, locationId, checkId, 'CHECK_ITEM_UPDATED', updatePayload, { commandId })

      await tx.processedCommand.create({
        data: {
          commandId,
          resultJson: JSON.stringify(updatedItem),
        },
      })

      return { item: updatedItem, eventResult }
    })

    // Broadcast check:event after txn commits — fire-and-forget
    void emitToLocation(locationId, 'check:event', {
      eventId: result.eventResult.eventId,
      checkId,
      serverSequence: result.eventResult.serverSequence,
      type: 'CHECK_ITEM_UPDATED',
      payload: updatePayload,
      commandId,
      deviceId: terminalId,
    }).catch(console.error)

    // If committed, also emit order events for terminals listening to order changes
    if (isCommitted) {
      void emitOrderEvent(locationId, check.orderId as string, 'ITEM_UPDATED', {
        lineItemId: itemId,
        ...updateFields,
        // Convert priceCents to dollars for order event consumers
        ...(updateFields.priceCents !== undefined && { price: updateFields.priceCents / 100 }),
      }).catch(console.error)
      void dispatchOpenOrdersChanged(locationId, {
        trigger: 'item_updated',
        orderId: check.orderId as string,
      }).catch(console.error)
    }

    return ok(result.item)
  } catch (error) {
    console.error('Failed to update check item:', error)
    return err('Failed to update check item', 500)
  }
})
