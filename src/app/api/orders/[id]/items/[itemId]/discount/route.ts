import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { parseSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { PERMISSIONS, hasPermission } from '@/lib/auth-utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { roundToCents } from '@/lib/pricing'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('orders.id.items.itemId.discount')

interface ApplyItemDiscountRequest {
  type: 'percent' | 'fixed'
  value: number
  reason?: string
  employeeId: string
  discountRuleId?: string
  approvedById?: string  // Manager ID if approval required
}

// POST — Apply item-level discount
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id: orderId, itemId } = await ctx.params
    const body = await request.json() as ApplyItemDiscountRequest
    // SECURITY: Use authenticated employee ID for permission check
    const authEmployeeId = ctx.auth.employeeId || body.employeeId

    // Validate required fields
    if (!body.type || body.value === undefined || body.value === null || !authEmployeeId) {
      return err('type, value, and employeeId are required')
    }

    if (body.value <= 0) {
      return err('Discount value must be greater than 0')
    }

    if (body.type === 'percent' && body.value > 100) {
      return err('Percentage cannot exceed 100%')
    }

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent discount applications from producing incorrect totals
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

      // Fetch order with items for split-aware tax (tenant-safe via OrderRepository)
      const [lockedDisc] = await tx.$queryRaw<Array<{ locationId: string }>>`SELECT "locationId" FROM "Order" WHERE id = ${orderId}`
      if (!lockedDisc) {
        return notFound('Order not found')
      }
      const order = await OrderRepository.getOrderByIdWithInclude(orderId, lockedDisc.locationId, {
        location: true,
        items: { where: { deletedAt: null, status: 'active' }, include: { modifiers: true } },
      }, tx)

      if (!order) {
        return notFound('Order not found')
      }

      // Auth check — require manager.discounts permission using verified identity
      const auth = await requirePermission(authEmployeeId, order.locationId, PERMISSIONS.MGR_DISCOUNTS)
      if (!auth.authorized) return err(auth.error, auth.status)

      if (order.status === 'paid' || order.status === 'closed') {
        return err('Cannot apply discount to a paid or closed order', 409)
      }

      // Fetch item (tenant-safe via OrderItemRepository)
      const item = await OrderItemRepository.getItemByIdWithInclude(itemId, order.locationId, {
        menuItem: { select: { itemType: true } },
      }, tx)

      if (!item) {
        return notFound('Order item not found')
      }

      // Block item-level discounts on timed_rental items (dynamic pricing makes fixed discounts unreliable)
      if (item.menuItem?.itemType === 'timed_rental') {
        return err('Cannot apply item-level discounts to timed rental items. Use order-level discounts instead.')
      }

      // Parse location settings for approval rules (consistent with order-level discount route)
      const settings = parseSettings(order.location.settings)
      const approvalSettings = settings.approvals

      // Pre-calculate discount percent to check approval requirement
      let discountPercentForApproval: number | null = null
      if (body.type === 'percent') {
        discountPercentForApproval = body.value
      } else if (body.type === 'fixed') {
        // For fixed discounts, calculate the percentage relative to item total
        discountPercentForApproval = roundToCents(Number(item.itemTotal) > 0
          ? (body.value / Number(item.itemTotal)) * 100
          : 0)
      }

      // W4-1: Check if approval is required based on discount threshold
      let requiresApproval = false
      if (discountPercentForApproval && discountPercentForApproval > approvalSettings.discountApprovalThreshold) {
        requiresApproval = true
      }

      // W4-1: Check location-level discount approval requirement (matches order-level route)
      if (approvalSettings.requireDiscountApproval) {
        requiresApproval = true
      }

      // W4-2: Per-role discount limit — non-managers capped at defaultMaxDiscountPercent
      if (authEmployeeId && discountPercentForApproval) {
        const emp = await tx.employee.findUnique({
          where: { id: authEmployeeId, deletedAt: null },
          include: { role: true },
        })
        if (emp) {
          const perms = (emp.role?.permissions as string[]) || []
          const hasMgrDiscount = hasPermission(perms, PERMISSIONS.MGR_DISCOUNTS)

          if (!hasMgrDiscount && discountPercentForApproval > approvalSettings.defaultMaxDiscountPercent) {
            return NextResponse.json(
              { error: 'Discount exceeds your limit. Manager approval required.', requiresApproval: true, maxPercent: approvalSettings.defaultMaxDiscountPercent },
              { status: 403 }
            )
          }
        }
      }

      // W4-1: Enforce approval — if required but not provided, block
      if (requiresApproval && !body.approvedById) {
        return NextResponse.json(
          { error: 'Manager approval required', requiresApproval: true },
          { status: 403 }
        )
      }

      // W4-1: Validate approver has manager.discounts permission
      if (body.approvedById) {
        const approverAuth = await requirePermission(body.approvedById, order.locationId, PERMISSIONS.MGR_DISCOUNTS)
        if (!approverAuth.authorized) {
          return forbidden('Approver does not have discount permission')
        }
      }

      // Toggle prevention: if this discountRuleId is already applied to this item, remove it
      if (body.discountRuleId) {
        const alreadyApplied = await tx.orderItemDiscount.findFirst({
          where: { orderItemId: itemId, discountRuleId: body.discountRuleId, deletedAt: null },
        })
        if (alreadyApplied) {
          const removedAmount = Number(alreadyApplied.amount)
          await tx.orderItemDiscount.update({
            where: { id: alreadyApplied.id },
            data: { deletedAt: new Date() },
          })
          const newDiscountTotal = Math.max(0, Number(order.discountTotal) - removedAmount)
          const calcItems: OrderItemForCalculation[] = order.items.map(i => ({
            price: Number(i.price), quantity: i.quantity, status: i.status,
            itemTotal: Number(i.itemTotal), isTaxInclusive: i.isTaxInclusive ?? false,
            modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
          }))
          const totals = calculateOrderTotals(
            calcItems, order.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } },
            newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt,
            Number(order.inclusiveTaxRate) || undefined, 0,
            (order as any).exclusiveTaxRate != null ? Number((order as any).exclusiveTaxRate) : undefined
          )
          const toggleDonation = Number(order.donationAmount || 0)
          const toggleConvFee = Number(order.convenienceFee || 0)
          const toggleFinalTotal = toggleDonation > 0 || toggleConvFee > 0
            ? roundToCents(totals.total + toggleDonation + toggleConvFee)
            : totals.total
          await OrderRepository.updateOrder(orderId, order.locationId, { discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, taxFromInclusive: totals.taxFromInclusive, taxFromExclusive: totals.taxFromExclusive, total: toggleFinalTotal }, tx)
          const updatedOrder = await OrderRepository.getOrderByIdWithSelect(orderId, order.locationId, { subtotal: true, discountTotal: true, taxTotal: true, tipTotal: true, total: true }, tx)
          if (!updatedOrder) throw new Error(`Order ${orderId} not found after update`)
          void dispatchOpenOrdersChanged(order.locationId, { trigger: 'created', orderId }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))
          void dispatchOrderTotalsUpdate(order.locationId, orderId, {
            subtotal: Number(updatedOrder.subtotal),
            taxTotal: Number(updatedOrder.taxTotal),
            tipTotal: Number(updatedOrder.tipTotal),
            discountTotal: Number(updatedOrder.discountTotal),
            total: Number(updatedOrder.total),
          }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId.discount'))
          void emitOrderEvent(order.locationId, orderId, 'DISCOUNT_REMOVED', {
            discountId: alreadyApplied.id,
            lineItemId: itemId,
          })

          return ok({
              toggled: 'off',
              removedDiscountId: alreadyApplied.id,
              orderTotals: {
                subtotal: Number(updatedOrder.subtotal),
                discountTotal: Number(updatedOrder.discountTotal),
                taxTotal: Number(updatedOrder.taxTotal),
                total: Number(updatedOrder.total),
              },
            })
        }
      }

      // Calculate discount amount
      let discountAmount: number
      let discountPercent: number | null = null

      if (body.type === 'fixed') {
        discountAmount = Math.min(body.value, Number(item.itemTotal))
      } else {
        discountPercent = body.value
        discountAmount = roundToCents(Number(item.itemTotal) * (body.value / 100))
      }

      // Cap the new discount so total item-level discounts never exceed the item price
      const existingItemDiscounts = await tx.orderItemDiscount.aggregate({
        where: { orderItemId: itemId, deletedAt: null },
        _sum: { amount: true },
      })
      const existingDiscountSum = Number(existingItemDiscounts._sum.amount || 0)
      const maxNewDiscount = Math.max(0, Number(item.itemTotal) - existingDiscountSum)
      discountAmount = Math.min(discountAmount, maxNewDiscount)
      if (discountAmount <= 0) {
        return err('Item is already fully discounted')
      }

      // Create the OrderItemDiscount record
      const itemDiscount = await tx.orderItemDiscount.create({
        data: {
          locationId: order.locationId,
          orderId,
          orderItemId: itemId,
          discountRuleId: body.discountRuleId ?? null,
          amount: discountAmount,
          percent: discountPercent,
          appliedById: body.employeeId,
          reason: body.reason ?? null,
        },
      })

      // Update Order.discountTotal (increment) and recalculate total via calculateOrderTotals
      const newDiscountTotal = Number(order.discountTotal) + discountAmount
      const applyCalcItems: OrderItemForCalculation[] = order.items.map(i => ({
        price: Number(i.price), quantity: i.quantity, status: i.status,
        itemTotal: Number(i.itemTotal), isTaxInclusive: i.isTaxInclusive ?? false,
        modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
      }))
      const totals = calculateOrderTotals(
        applyCalcItems, order.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } },
        newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt,
        Number(order.inclusiveTaxRate) || undefined, 0,
        (order as any).exclusiveTaxRate != null ? Number((order as any).exclusiveTaxRate) : undefined
      )

      const applyDonation = Number(order.donationAmount || 0)
      const applyConvFee = Number(order.convenienceFee || 0)
      const applyFinalTotal = applyDonation > 0 || applyConvFee > 0
        ? roundToCents(totals.total + applyDonation + applyConvFee)
        : totals.total

      await OrderRepository.updateOrder(orderId, order.locationId, {
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
        total: applyFinalTotal,
      }, tx)
      const updatedOrder = await OrderRepository.getOrderByIdWithSelect(orderId, order.locationId, { subtotal: true, discountTotal: true, taxTotal: true, tipTotal: true, total: true }, tx)
      if (!updatedOrder) throw new Error(`Order ${orderId} not found after update`)

      // Emit order event for item discount applied (fire-and-forget)
      void emitOrderEvent(order.locationId, orderId, 'DISCOUNT_APPLIED', {
        discountId: itemDiscount.id,
        type: body.type,
        value: body.value,
        amountCents: Math.round(Number(itemDiscount.amount) * 100),
        reason: body.reason || null,
        lineItemId: itemId,
      })

      // Fire-and-forget socket dispatch
      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'created',
        orderId,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId.discount'))
      void dispatchOrderTotalsUpdate(order.locationId, orderId, {
        subtotal: Number(updatedOrder.subtotal),
        taxTotal: Number(updatedOrder.taxTotal),
        tipTotal: Number(updatedOrder.tipTotal),
        discountTotal: Number(updatedOrder.discountTotal),
        total: Number(updatedOrder.total),
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId.discount'))
      // Audit log for manager-approved discount (W4-1)
      if (body.approvedById) {
        await tx.auditLog.create({
          data: {
            locationId: order.locationId,
            action: 'item_discount_approved',
            employeeId: body.approvedById,
            details: JSON.stringify({
              orderId,
              itemId,
              discountId: itemDiscount.id,
              type: body.type,
              value: body.value,
              appliedBy: body.employeeId,
              approvedBy: body.approvedById,
              reason: body.reason,
            }),
          },
        })
      }

      return ok({
          discount: {
            id: itemDiscount.id,
            amount: Number(itemDiscount.amount),
            percent: itemDiscount.percent !== null ? Number(itemDiscount.percent) : null,
            reason: itemDiscount.reason,
            appliedById: itemDiscount.appliedById,
            createdAt: itemDiscount.createdAt.toISOString(),
          },
          newItemTotal: Number(item.itemTotal) - discountAmount,
          newOrderTotal: Number(updatedOrder.total),
          orderTotals: {
            subtotal: Number(updatedOrder.subtotal),
            discountTotal: Number(updatedOrder.discountTotal),
            taxTotal: Number(updatedOrder.taxTotal),
            total: Number(updatedOrder.total),
          },
        })
    })

    pushUpstream()

    return result
  } catch (error) {
    console.error('Failed to apply item discount:', error)
    return err('Failed to apply item discount', 500)
  }
}))

// DELETE — Remove an item discount
// Query: ?discountId={id}
export const DELETE = withVenue(withAuth({ allowCellular: true }, async function DELETE(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id: orderId, itemId } = await ctx.params
    const discountId = request.nextUrl.searchParams.get('discountId')
    // SECURITY: Use authenticated employee ID for permission check
    const employeeId = ctx.auth.employeeId || request.nextUrl.searchParams.get('employeeId')

    if (!discountId) {
      return err('discountId query parameter is required')
    }

    if (!employeeId) {
      return err('employeeId query parameter is required')
    }

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent discount removals from producing incorrect totals
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

      // Fetch the discount and verify it belongs to this order/item
      const existingDiscount = await tx.orderItemDiscount.findFirst({
        where: {
          id: discountId,
          orderId,
          orderItemId: itemId,
          deletedAt: null,
        },
      })

      if (!existingDiscount) {
        return notFound('Discount not found on this item')
      }

      // Fetch order with items for split-aware tax recalculation (tenant-safe via OrderRepository)
      const [lockedDiscDel] = await tx.$queryRaw<Array<{ locationId: string }>>`SELECT "locationId" FROM "Order" WHERE id = ${orderId}`
      if (!lockedDiscDel) {
        return notFound('Order not found')
      }
      const order = await OrderRepository.getOrderByIdWithInclude(orderId, lockedDiscDel.locationId, {
        location: true,
        items: { where: { deletedAt: null, status: 'active' }, include: { modifiers: true } },
      }, tx)

      if (!order) {
        return notFound('Order not found')
      }

      // Auth check — require manager.discounts permission
      const authResult = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_DISCOUNTS)
      if (!authResult.authorized) return err(authResult.error, authResult.status ?? 403)

      const discountAmount = Number(existingDiscount.amount)

      // Soft delete the discount
      await tx.orderItemDiscount.update({
        where: { id: discountId },
        data: {
          updatedAt: new Date(),
          deletedAt: new Date(),
        },
      })

      // Update Order.discountTotal (decrement) and recalculate total via calculateOrderTotals
      const newDiscountTotal = Math.max(0, Number(order.discountTotal) - discountAmount)
      const delCalcItems: OrderItemForCalculation[] = order.items.map(i => ({
        price: Number(i.price), quantity: i.quantity, status: i.status,
        itemTotal: Number(i.itemTotal), isTaxInclusive: i.isTaxInclusive ?? false,
        modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
      }))
      const totals = calculateOrderTotals(
        delCalcItems, order.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } },
        newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt,
        Number(order.inclusiveTaxRate) || undefined, 0,
        (order as any).exclusiveTaxRate != null ? Number((order as any).exclusiveTaxRate) : undefined
      )

      const delDonation = Number(order.donationAmount || 0)
      const delConvFee = Number(order.convenienceFee || 0)
      const delFinalTotal = delDonation > 0 || delConvFee > 0
        ? roundToCents(totals.total + delDonation + delConvFee)
        : totals.total

      await OrderRepository.updateOrder(orderId, order.locationId, {
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
        total: delFinalTotal,
      }, tx)
      const updatedOrder = await OrderRepository.getOrderByIdWithSelect(orderId, order.locationId, { subtotal: true, discountTotal: true, taxTotal: true, tipTotal: true, total: true }, tx)
      if (!updatedOrder) throw new Error(`Order ${orderId} not found after update`)

      // Emit order event for item discount removed (fire-and-forget)
      void emitOrderEvent(order.locationId, orderId, 'DISCOUNT_REMOVED', {
        discountId,
        lineItemId: itemId,
      })

      // Fire-and-forget socket dispatch
      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'created',
        orderId,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId.discount'))
      void dispatchOrderTotalsUpdate(order.locationId, orderId, {
        subtotal: Number(updatedOrder.subtotal),
        taxTotal: Number(updatedOrder.taxTotal),
        tipTotal: Number(updatedOrder.tipTotal),
        discountTotal: Number(updatedOrder.discountTotal),
        total: Number(updatedOrder.total),
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.items.itemId.discount'))

      return ok({
          success: true,
          orderTotals: {
            subtotal: Number(updatedOrder.subtotal),
            discountTotal: Number(updatedOrder.discountTotal),
            taxTotal: Number(updatedOrder.taxTotal),
            total: Number(updatedOrder.total),
          },
        })
    })

    pushUpstream()

    return result
  } catch (error) {
    console.error('Failed to remove item discount:', error)
    return err('Failed to remove item discount', 500)
  }
}))
