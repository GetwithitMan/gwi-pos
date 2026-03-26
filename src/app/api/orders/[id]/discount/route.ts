import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'
import { dispatchCFDOrderUpdated } from '@/lib/socket-dispatch'
import { parseSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS, hasPermission } from '@/lib/auth-utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { checkOrderClaim } from '@/lib/order-claim'
import { dispatchAlert } from '@/lib/alert-service'
import { getLocationSettings } from '@/lib/location-cache'
import { isDiscountable } from '@/lib/domain/order-status'
import { roundToCents } from '@/lib/pricing'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { OrderTotalsUpdatedPayload, OrdersListChangedPayload, OrderSummaryUpdatedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('orders-discount')

interface ApplyDiscountRequest {
  // Either use a preset discount rule or custom values
  discountRuleId?: string
  // For custom/manual discounts
  type?: 'percent' | 'fixed'
  value?: number
  name?: string
  reason?: string
  employeeId?: string
  approvedById?: string  // Manager ID if approval required
}

// POST - Apply a discount to an order
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json() as ApplyDiscountRequest

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularDiscount = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularDiscount ? 'cloud' : 'local'

    // Order claim check — block if another employee has an active claim
    if (body.employeeId) {
      const terminalId = request.headers.get('x-terminal-id')
      const claimBlock = await checkOrderClaim(db, orderId, body.employeeId, terminalId)
      if (claimBlock) {
        return NextResponse.json(
          { error: claimBlock.error, claimedBy: claimBlock.claimedBy },
          { status: claimBlock.status }
        )
      }
    }

    // Track successful discount application for alert dispatch (mutable ref for TypeScript closure tracking)
    const alertRef: { info: { locationId: string; orderNumber: number; discountName: string; discountAmount: number; employeeId: string | null } | null } = { info: null }
    // Track locationId for outbox flush after transaction commits
    let outboxLocationId: string | null = null

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent discount applications from bypassing stacking/cap guards
      const [lockedRow] = await tx.$queryRawUnsafe<Array<{ id: string; locationId: string }>>(
        'SELECT id, "locationId" FROM "Order" WHERE id = $1 FOR UPDATE', orderId
      )
      if (!lockedRow) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }

      // Get the order with current totals (tenant-safe via OrderRepository)
      const order = await OrderRepository.getOrderByIdWithInclude(orderId, lockedRow.locationId, {
        location: true,
        discounts: { where: { deletedAt: null } },
        items: {
          where: { deletedAt: null, status: 'active' },
          include: { modifiers: true },
        },
      }, tx)

      if (!order) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }

      // Capture locationId for outbox flush after commit
      outboxLocationId = order.locationId

      // Auth check — require manager.discounts permission
      const auth = await requirePermission(body.employeeId, order.locationId, PERMISSIONS.MGR_DISCOUNTS)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

      if (!isDiscountable(order.status)) {
        return NextResponse.json(
          { error: order.status === 'split'
            ? 'Cannot discount a split parent order — discount individual splits instead'
            : `Cannot add discount to order in '${order.status}' status` },
          { status: 400 }
        )
      }

      // Parse location settings for approval rules (W4-1, W4-2)
      const settings = parseSettings(order.location.settings)
      const approvalSettings = settings.approvals

      let discountName: string
      let discountAmount: number
      let discountPercent: number | null = null
      let discountRuleId: string | null = null
      let requiresApproval = false

      if (body.discountRuleId) {
        // Using a preset discount rule
        const rule = await tx.discountRule.findUnique({
          where: { id: body.discountRuleId, deletedAt: null },
        })

        if (!rule) {
          return NextResponse.json(
            { error: 'Discount rule not found' },
            { status: 404 }
          )
        }

        if (!rule.isActive) {
          return NextResponse.json(
            { error: 'This discount is not active' },
            { status: 400 }
          )
        }

        // Toggle behavior: if this rule is already applied, remove it instead of stacking
        const alreadyApplied = order.discounts.find(d => d.discountRuleId === rule.id)
        if (alreadyApplied) {
          // Soft delete the existing discount
          await tx.orderDiscount.update({
            where: { id: alreadyApplied.id },
            data: { deletedAt: new Date() },
          })

          // Recalculate order totals without this discount
          const newDiscountTotal = order.discounts
            .filter(d => d.id !== alreadyApplied.id)
            .reduce((sum, d) => sum + Number(d.amount), 0)

          const orderItems: OrderItemForCalculation[] = order.items.map(i => ({
            price: Number(i.price),
            quantity: i.quantity,
            status: i.status,
            itemTotal: Number(i.itemTotal),
            isTaxInclusive: (i as any).isTaxInclusive ?? false,
            modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
          }))
          const totals = calculateOrderTotals(
            orderItems,
            order.location.settings as { tax?: { defaultRate?: number } },
            newDiscountTotal,
            Number(order.tipTotal || 0),
            undefined,
            'card',
            order.isTaxExempt,
            Number(order.inclusiveTaxRate) || undefined
          )

          const donationAmount = Number(order.donationAmount || 0)
          const convenienceFee = Number(order.convenienceFee || 0)
          const finalTotal = donationAmount > 0 || convenienceFee > 0
            ? roundToCents(totals.total + donationAmount + convenienceFee)
            : totals.total

          await OrderRepository.updateOrder(orderId, order.locationId, {
            discountTotal: totals.discountTotal,
            taxTotal: totals.taxTotal,
            taxFromInclusive: totals.taxFromInclusive,
            taxFromExclusive: totals.taxFromExclusive,
            total: finalTotal,
            version: { increment: 1 },
            lastMutatedBy: mutationOrigin,
          }, tx)

          // Queue critical socket events in the outbox (atomic with discount removal)
          const toggleTotalsPayload: OrderTotalsUpdatedPayload = {
            orderId,
            totals: {
              subtotal: totals.subtotal,
              taxTotal: totals.taxTotal,
              tipTotal: Number(order.tipTotal),
              discountTotal: totals.discountTotal,
              total: finalTotal,
              commissionTotal: Number(order.commissionTotal || 0),
            },
            timestamp: new Date().toISOString(),
          }
          await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_TOTALS_UPDATED, toggleTotalsPayload)

          const toggleListPayload: OrdersListChangedPayload = {
            trigger: 'item_updated',
            orderId,
          }
          await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, toggleListPayload)

          const toggleSummaryPayload: OrderSummaryUpdatedPayload = {
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            tableId: order.tableId || null,
            tableName: null,
            tabName: order.tabName || null,
            guestCount: order.guestCount ?? 0,
            employeeId: order.employeeId || null,
            subtotalCents: Math.round(totals.subtotal * 100),
            taxTotalCents: Math.round(totals.taxTotal * 100),
            discountTotalCents: Math.round(totals.discountTotal * 100),
            tipTotalCents: Math.round(Number(order.tipTotal) * 100),
            totalCents: Math.round(finalTotal * 100),
            itemCount: order.itemCount ?? 0,
            updatedAt: new Date().toISOString(),
            locationId: order.locationId,
          }
          await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_SUMMARY_UPDATED, toggleSummaryPayload)

          // Emit order event for discount removed via toggle (fire-and-forget)
          void emitOrderEvent(order.locationId, orderId, 'DISCOUNT_REMOVED', {
            discountId: alreadyApplied.id,
            lineItemId: null,
          })

          // CFD: update customer display with new totals (fire-and-forget)
          void dispatchCFDOrderUpdated(order.locationId, {
            orderId,
            orderNumber: order.orderNumber,
            items: order.items.filter(i => i.status === 'active').map(i => ({
              name: i.name,
              quantity: i.quantity,
              price: Number(i.itemTotal),
              modifiers: i.modifiers.map(m => m.name),
            })),
            subtotal: totals.subtotal,
            tax: totals.taxTotal,
            total: finalTotal,
            discountTotal: totals.discountTotal,
            taxFromInclusive: totals.taxFromInclusive,
            taxFromExclusive: totals.taxFromExclusive,
          })

          return NextResponse.json({ data: {
            toggled: 'off',
            removedDiscountId: alreadyApplied.id,
            orderTotals: {
              subtotal: totals.subtotal,
              discountTotal: totals.discountTotal,
              taxTotal: totals.taxTotal,
              total: finalTotal,
            },
          } })
        }

        // Employee discount guard: if this rule is employee-only, enforce on-clock validation
        if (rule.isEmployeeDiscount) {
          if (!body.employeeId) {
            return NextResponse.json(
              { error: 'Employee ID is required for employee discounts' },
              { status: 400 }
            )
          }

          // Verify the applying employee is currently clocked in
          const activeClockEntry = await tx.timeClockEntry.findFirst({
            where: {
              employeeId: body.employeeId,
              locationId: order.locationId,
              clockOut: null,
            },
          })

          if (!activeClockEntry) {
            return NextResponse.json(
              { error: 'Employee must be clocked in to use an employee discount' },
              { status: 403 }
            )
          }
        }

        // Check max per order
        if (rule.maxPerOrder) {
          const existingCount = order.discounts.filter(
            d => d.discountRuleId === rule.id
          ).length
          if (existingCount >= rule.maxPerOrder) {
            return NextResponse.json(
              { error: `This discount can only be applied ${rule.maxPerOrder} time(s) per order` },
              { status: 400 }
            )
          }
        }

        // Check stackability
        if (!rule.isStackable && order.discounts.length > 0) {
          return NextResponse.json(
            { error: 'This discount cannot be combined with other discounts' },
            { status: 400 }
          )
        }

        const config = rule.discountConfig as { type: 'percent' | 'fixed'; value: number; maxAmount?: number }
        discountName = rule.displayText
        discountRuleId = rule.id
        requiresApproval = rule.requiresApproval

        if (config.type === 'percent') {
          discountPercent = config.value
          discountAmount = Math.round(Number(order.subtotal) * (config.value / 100) * 100) / 100
          // Apply max cap if specified
          if (config.maxAmount && discountAmount > config.maxAmount) {
            discountAmount = config.maxAmount
          }
        } else {
          discountAmount = config.value
        }
      } else {
        // Manual/custom discount
        if (!body.type || !body.value || !isFinite(body.value) || body.value <= 0) {
          return NextResponse.json(
            { error: 'Discount type and value are required' },
            { status: 400 }
          )
        }

        // Reverse stackability check: block manual discount when a non-stackable rule is already applied
        if (order.discounts.length > 0) {
          const ruleIds = order.discounts
            .map(d => d.discountRuleId)
            .filter((id): id is string => id != null)
          if (ruleIds.length > 0) {
            const nonStackableRule = await tx.discountRule.findFirst({
              where: { id: { in: ruleIds }, isStackable: false, deletedAt: null },
              select: { displayText: true },
            })
            if (nonStackableRule) {
              return NextResponse.json(
                { error: `Cannot add manual discount — a non-stackable discount ("${nonStackableRule.displayText}") is already applied` },
                { status: 400 }
              )
            }
          }
        }

        // Normalize type: accept 'percent'/'PERCENTAGE'/'Percent' and 'fixed'/'FIXED'/'Fixed'/'FLAT'
        const normalizedType = body.type.toLowerCase().startsWith('percent') ? 'percent' : 'fixed'

        discountName = body.name || (normalizedType === 'percent' ? `${body.value}% Off` : `$${body.value} Off`)

        if (normalizedType === 'percent') {
          if (body.value > 100) {
            return NextResponse.json(
              { error: 'Percentage cannot exceed 100%' },
              { status: 400 }
            )
          }
          discountPercent = body.value
          discountAmount = Math.round(Number(order.subtotal) * (body.value / 100) * 100) / 100
        } else {
          discountAmount = body.value
        }

        // Use configurable threshold from location settings (W4-1)
        if (discountPercent && discountPercent > approvalSettings.discountApprovalThreshold) {
          requiresApproval = true
        }
      }

      // W4-1: Check location-level discount approval requirement
      if (approvalSettings.requireDiscountApproval) {
        requiresApproval = true
      }

      // W4-2: Per-role discount limit — check if employee has manager.discounts permission
      if (body.employeeId && discountPercent) {
        const emp = await tx.employee.findUnique({
          where: { id: body.employeeId, deletedAt: null },
          include: { role: true },
        })
        if (emp) {
          const perms = (emp.role?.permissions as string[]) || []
          const hasMgrDiscount = hasPermission(perms, PERMISSIONS.MGR_DISCOUNTS)

          if (!hasMgrDiscount && discountPercent > approvalSettings.defaultMaxDiscountPercent) {
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
          return NextResponse.json(
            { error: 'Approver does not have discount permission' },
            { status: 403 }
          )
        }
      }

      // Ensure discount doesn't exceed subtotal (considering both order-level AND item-level discounts)
      const currentDiscountTotal = order.discounts.reduce(
        (sum, d) => sum + Number(d.amount),
        0
      )
      const itemLevelDiscounts = await tx.orderItemDiscount.aggregate({
        where: {
          orderItem: { orderId, deletedAt: null, status: 'active' },
          deletedAt: null,
        },
        _sum: { amount: true },
      })
      const totalExistingDiscounts = currentDiscountTotal + Number(itemLevelDiscounts._sum.amount || 0)
      const maxAllowedDiscount = Number(order.subtotal) - totalExistingDiscounts

      // Fix 4: Reject fixed discounts that exceed remaining subtotal (don't silently clamp)
      if (discountPercent == null && discountAmount > Number(order.subtotal)) {
        return NextResponse.json(
          { error: `Discount amount $${discountAmount.toFixed(2)} exceeds order subtotal $${Number(order.subtotal).toFixed(2)}` },
          { status: 400 }
        )
      }

      if (discountAmount > maxAllowedDiscount) {
        return NextResponse.json(
          { error: `Discount amount $${discountAmount.toFixed(2)} exceeds remaining discountable balance of $${maxAllowedDiscount.toFixed(2)}. Reduce the discount or remove existing discounts first.` },
          { status: 400 }
        )
      }

      if (discountAmount <= 0) {
        return NextResponse.json(
          { error: 'No discount amount to apply' },
          { status: 400 }
        )
      }

      // Create the discount record
      const discount = await tx.orderDiscount.create({
        data: {
          locationId: order.locationId,
          orderId,
          discountRuleId,
          name: discountName,
          amount: discountAmount,
          percent: discountPercent,
          appliedBy: body.employeeId || null,
          isAutomatic: false,
          reason: body.reason || null,
        },
      })

      // W4-1: Log manager override to AuditLog when approval was provided
      if (body.approvedById) {
        void tx.auditLog.create({
          data: {
            locationId: order.locationId,
            employeeId: body.approvedById,
            action: 'discount_override',
            entityType: 'order',
            entityId: orderId,
            details: {
              discountId: discount.id,
              discountName,
              discountAmount,
              discountPercent,
              requestedBy: body.employeeId || null,
              approvedBy: body.approvedById,
              reason: body.reason || null,
            },
          },
        }).catch(err => console.error('[AuditLog] Failed to log discount override:', err))
      }

      // Update order totals
      const newDiscountTotal = currentDiscountTotal + discountAmount
      const applyItems: OrderItemForCalculation[] = order.items.map(i => ({
        price: Number(i.price),
        quantity: i.quantity,
        status: i.status,
        itemTotal: Number(i.itemTotal),
        isTaxInclusive: (i as any).isTaxInclusive ?? false,
        modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
      }))
      const totals = calculateOrderTotals(applyItems, order.location.settings as { tax?: { defaultRate?: number } }, newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt, Number(order.inclusiveTaxRate) || undefined)

      const applyDonationAmount = Number(order.donationAmount || 0)
      const applyConvenienceFee = Number(order.convenienceFee || 0)
      const applyFinalTotal = applyDonationAmount > 0 || applyConvenienceFee > 0
        ? roundToCents(totals.total + applyDonationAmount + applyConvenienceFee)
        : totals.total

      await OrderRepository.updateOrder(orderId, order.locationId, {
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
        total: applyFinalTotal,
        version: { increment: 1 },
        lastMutatedBy: mutationOrigin,
      }, tx)

      // Emit order event for discount applied (fire-and-forget)
      void emitOrderEvent(order.locationId, orderId, 'DISCOUNT_APPLIED', {
        discountId: discount.id,
        type: discountPercent != null ? 'percent' : 'fixed',
        value: discountPercent ?? discountAmount,
        amountCents: Math.round(Number(discount.amount) * 100),
        reason: body.reason || null,
      })

      // Queue critical socket events in the outbox (atomic with discount application)
      const applyTotalsPayload: OrderTotalsUpdatedPayload = {
        orderId,
        totals: {
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          tipTotal: Number(order.tipTotal),
          discountTotal: totals.discountTotal,
          total: applyFinalTotal,
          commissionTotal: Number(order.commissionTotal || 0),
        },
        timestamp: new Date().toISOString(),
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_TOTALS_UPDATED, applyTotalsPayload)

      const applyListPayload: OrdersListChangedPayload = {
        trigger: 'item_updated',
        orderId,
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, applyListPayload)

      const applySummaryPayload: OrderSummaryUpdatedPayload = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        tableId: order.tableId || null,
        tableName: null,
        tabName: order.tabName || null,
        guestCount: order.guestCount ?? 0,
        employeeId: order.employeeId || null,
        subtotalCents: Math.round(totals.subtotal * 100),
        taxTotalCents: Math.round(totals.taxTotal * 100),
        discountTotalCents: Math.round(totals.discountTotal * 100),
        tipTotalCents: Math.round(Number(order.tipTotal) * 100),
        totalCents: Math.round(applyFinalTotal * 100),
        itemCount: order.itemCount ?? 0,
        updatedAt: new Date().toISOString(),
        locationId: order.locationId,
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_SUMMARY_UPDATED, applySummaryPayload)

      // CFD: update customer display with new totals (fire-and-forget, non-critical UI)
      void dispatchCFDOrderUpdated(order.locationId, {
        orderId,
        orderNumber: order.orderNumber,
        items: order.items.filter(i => i.status === 'active').map(i => ({
          name: i.name,
          quantity: i.quantity,
          price: Number(i.itemTotal),
          modifiers: i.modifiers.map(m => m.name),
        })),
        subtotal: totals.subtotal,
        tax: totals.taxTotal,
        total: applyFinalTotal,
        discountTotal: totals.discountTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
      })

      // Track for post-transaction alert dispatch
      alertRef.info = {
        locationId: order.locationId,
        orderNumber: order.orderNumber,
        discountName,
        discountAmount,
        employeeId: body.employeeId || null,
      }

      return NextResponse.json({ data: {
        discount: {
          id: discount.id,
          name: discount.name,
          amount: Number(discount.amount),
          percent: discount.percent ? Number(discount.percent) : null,
        },
        orderTotals: {
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          total: applyFinalTotal,
        },
        requiresApproval,
      } })
    })

    // Transaction committed — flush outbox (fire-and-forget, catch-up handles failures)
    if (outboxLocationId) {
      flushOutboxSafe(outboxLocationId)
    }

    // Audit trail for discount application
    if (alertRef.info) {
      const auditInfo = alertRef.info
      console.log(`[AUDIT] DISCOUNT_APPLIED: orderId=${orderId}, type=${auditInfo.discountName}, amount=$${auditInfo.discountAmount}, reason="${body.reason || 'none'}", by employee ${auditInfo.employeeId}`)
    }

    // Alert dispatch: notify if discount exceeds threshold (fire-and-forget)
    if (alertRef.info) {
      const info = alertRef.info
      void (async () => {
        try {
          // Use cached location settings instead of redundant DB fetch
          const cachedSettings = await getLocationSettings(info.locationId)
          const locSettings = parseSettings(cachedSettings)
          if (!locSettings.alerts.enabled) return
          if (info.discountAmount < locSettings.alerts.largeDiscountThreshold) return

          void dispatchAlert({
            severity: 'MEDIUM',
            errorType: 'large_discount',
            category: 'transaction',
            message: `Large discount applied: ${info.discountName} - $${info.discountAmount.toFixed(2)} on Order #${info.orderNumber}`,
            locationId: info.locationId,
            employeeId: info.employeeId ?? undefined,
            orderId,
            groupId: `discount-${info.locationId}-${orderId}`,
          }).catch(err => log.warn({ err }, 'Background task failed'))
        } catch (err) {
          console.error('[discount] Alert dispatch failed:', err)
        }
      })()
    }

    return result
  } catch (error) {
    console.error('Failed to apply discount:', error)
    return NextResponse.json(
      { error: 'Failed to apply discount' },
      { status: 500 }
    )
  }
})

// GET - Get discounts applied to an order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const discounts = await db.orderDiscount.findMany({
      where: { orderId, deletedAt: null },
      include: {
        discountRule: {
          select: {
            name: true,
            displayText: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ data: {
      discounts: discounts.map(d => ({
        id: d.id,
        name: d.name,
        amount: Number(d.amount),
        percent: d.percent ? Number(d.percent) : null,
        discountRuleId: d.discountRuleId,
        ruleName: d.discountRule?.name || null,
        appliedBy: d.appliedBy,
        isAutomatic: d.isAutomatic,
        reason: d.reason,
        createdAt: d.createdAt.toISOString(),
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch order discounts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch discounts' },
      { status: 500 }
    )
  }
})

// DELETE - Remove a discount from an order
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const searchParams = request.nextUrl.searchParams
    const discountId = searchParams.get('discountId')
    const employeeId = searchParams.get('employeeId')

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularDelete = request.headers.get('x-cellular-authenticated') === '1'
    const deleteMutationOrigin = isCellularDelete ? 'cloud' : 'local'

    if (!discountId) {
      return NextResponse.json(
        { error: 'Discount ID is required' },
        { status: 400 }
      )
    }

    if (!employeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 400 }
      )
    }

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent discount removals from producing incorrect totals
      const [lockedRowDel] = await tx.$queryRawUnsafe<Array<{ id: string; locationId: string }>>(
        'SELECT id, "locationId" FROM "Order" WHERE id = $1 FOR UPDATE', orderId
      )
      if (!lockedRowDel) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }

      // Get the order and discount (tenant-safe via OrderRepository)
      const order = await OrderRepository.getOrderByIdWithInclude(orderId, lockedRowDel.locationId, {
        location: true,
        discounts: {
          where: { deletedAt: null },
          include: { discountRule: { select: { name: true } } },
        },
        items: {
          where: { deletedAt: null, status: 'active' },
          include: { modifiers: true },
        },
      }, tx)

      if (!order) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }

      // Auth check — require manager.discounts permission
      const authResult = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_DISCOUNTS)
      if (!authResult.authorized) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status ?? 403 })
      }

      const discountToRemove = order.discounts.find(d => d.id === discountId)
      if (!discountToRemove) {
        return NextResponse.json(
          { error: 'Discount not found on this order' },
          { status: 404 }
        )
      }

      // Soft delete the discount
      await tx.orderDiscount.update({
        where: { id: discountId },
        data: { deletedAt: new Date() },
      })

      // If this discount came from a coupon, decrement usage count and soft-delete the redemption
      if (discountToRemove.couponId) {
        await tx.coupon.update({
          where: { id: discountToRemove.couponId },
          data: { usageCount: { decrement: 1 } },
        })

        // Soft-delete the associated CouponRedemption record
        const redemption = await tx.couponRedemption.findFirst({
          where: {
            couponId: discountToRemove.couponId,
            orderId,
            deletedAt: null,
          },
        })
        if (redemption) {
          await tx.couponRedemption.update({
            where: { id: redemption.id },
            data: { deletedAt: new Date() },
          })
        }
      }

      // Audit log for discount removal
      await tx.auditLog.create({
        data: {
          locationId: order.locationId,
          employeeId,
          action: 'discount_removed',
          entityType: 'order_discount',
          entityId: discountId,
          details: {
            orderId,
            orderNumber: order.orderNumber,
            discountId,
            discountName: discountToRemove.discountRule?.name ?? discountToRemove.reason ?? 'manual',
            amount: Number(discountToRemove.amount),
            percent: discountToRemove.percent ? Number(discountToRemove.percent) : null,
          },
          ipAddress: request.headers.get('x-forwarded-for'),
          userAgent: request.headers.get('user-agent'),
        },
      })

      // Recalculate order totals
      const newDiscountTotal = order.discounts
        .filter(d => d.id !== discountId)
        .reduce((sum, d) => sum + Number(d.amount), 0)

      const deleteItems: OrderItemForCalculation[] = order.items.map(i => ({
        price: Number(i.price),
        quantity: i.quantity,
        status: i.status,
        itemTotal: Number(i.itemTotal),
        isTaxInclusive: (i as any).isTaxInclusive ?? false,
        modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
      }))
      const totals = calculateOrderTotals(deleteItems, order.location.settings as { tax?: { defaultRate?: number } }, newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt, Number(order.inclusiveTaxRate) || undefined)

      const delDonationAmount = Number(order.donationAmount || 0)
      const delConvenienceFee = Number(order.convenienceFee || 0)
      const delFinalTotal = delDonationAmount > 0 || delConvenienceFee > 0
        ? roundToCents(totals.total + delDonationAmount + delConvenienceFee)
        : totals.total

      await OrderRepository.updateOrder(orderId, order.locationId, {
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
        total: delFinalTotal,
        version: { increment: 1 },
        lastMutatedBy: deleteMutationOrigin,
      }, tx)

      // Emit order event for discount removed (fire-and-forget)
      void emitOrderEvent(order.locationId, orderId, 'DISCOUNT_REMOVED', {
        discountId,
      })

      // Queue critical socket events in the outbox (atomic with discount removal)
      const delTotalsPayload: OrderTotalsUpdatedPayload = {
        orderId,
        totals: {
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          tipTotal: Number(order.tipTotal),
          discountTotal: totals.discountTotal,
          total: delFinalTotal,
          commissionTotal: Number(order.commissionTotal || 0),
        },
        timestamp: new Date().toISOString(),
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_TOTALS_UPDATED, delTotalsPayload)

      const delListPayload: OrdersListChangedPayload = {
        trigger: 'item_updated',
        orderId,
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, delListPayload)

      const delSummaryPayload: OrderSummaryUpdatedPayload = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        tableId: order.tableId || null,
        tableName: null,
        tabName: order.tabName || null,
        guestCount: order.guestCount ?? 0,
        employeeId: order.employeeId || null,
        subtotalCents: Math.round(totals.subtotal * 100),
        taxTotalCents: Math.round(totals.taxTotal * 100),
        discountTotalCents: Math.round(totals.discountTotal * 100),
        tipTotalCents: Math.round(Number(order.tipTotal) * 100),
        totalCents: Math.round(delFinalTotal * 100),
        itemCount: order.itemCount ?? 0,
        updatedAt: new Date().toISOString(),
        locationId: order.locationId,
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_SUMMARY_UPDATED, delSummaryPayload)

      // CFD: update customer display with new totals (fire-and-forget, non-critical UI)
      void dispatchCFDOrderUpdated(order.locationId, {
        orderId,
        orderNumber: order.orderNumber,
        items: order.items.filter(i => i.status === 'active').map(i => ({
          name: i.name,
          quantity: i.quantity,
          price: Number(i.itemTotal),
          modifiers: i.modifiers.map(m => m.name),
        })),
        subtotal: totals.subtotal,
        tax: totals.taxTotal,
        total: delFinalTotal,
        discountTotal: totals.discountTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
      })

      return { response: NextResponse.json({ data: {
        success: true,
        orderTotals: {
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          total: delFinalTotal,
        },
      } }), locationId: order.locationId }
    })

    // Transaction committed — flush outbox (fire-and-forget, catch-up handles failures)
    if (result && 'locationId' in result) {
      flushOutboxSafe(result.locationId)
      return result.response
    }

    return result
  } catch (error) {
    console.error('Failed to remove discount:', error)
    return NextResponse.json(
      { error: 'Failed to remove discount' },
      { status: 500 }
    )
  }
})
