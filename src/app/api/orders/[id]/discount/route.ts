import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'
import { dispatchCFDOrderUpdated } from '@/lib/socket-dispatch'
import { parseSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
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
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { validateMutationApproval } from '@/lib/approval-tokens'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-discount')

// ── Zod schema for POST /api/orders/[id]/discount ───────────────────
const ApplyDiscountSchema = z.object({
  discountRuleId: z.string().min(1).optional(),
  type: z.enum(['percent', 'fixed']).optional(),
  value: z.number().nonnegative().optional(),
  name: z.string().max(200).optional(),
  reason: z.string().max(500).optional(),
  employeeId: z.string().min(1).optional(),
  approvedById: z.string().min(1).optional(),
  approvalToken: z.string().optional(),
}).passthrough()

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
  approvalToken?: string  // HMAC-signed token from verify-pin (mutation-bound)
}

// POST - Apply a discount to an order
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id: orderId } = await ctx.params
    const rawBody = await request.json()
    const parseResult = ApplyDiscountSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data as ApplyDiscountRequest

    // Validate mutation-bound approval token (if present)
    const tokenCheck = validateMutationApproval({ approvalToken: body.approvalToken, approvedById: body.approvedById, routeName: 'order-discount' })
    if (!tokenCheck.valid) {
      return err(tokenCheck.error, tokenCheck.status)
    }

    // SECURITY: Use authenticated employee ID for permission checks.
    // body.employeeId is still used for business logic (employee discount clock-in check)
    // but the auth gate uses the verified session identity.
    const authEmployeeId = ctx.auth.employeeId || body.employeeId

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
      const [lockedRow] = await tx.$queryRaw<Array<{ id: string; locationId: string }>>`
        SELECT id, "locationId" FROM "Order" WHERE id = ${orderId} FOR UPDATE
      `
      if (!lockedRow) {
        return notFound('Order not found')
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
        return notFound('Order not found')
      }

      // Capture locationId for outbox flush after commit
      outboxLocationId = order.locationId

      // Auth check — require manager.discounts permission using verified identity
      const auth = await requirePermission(authEmployeeId, order.locationId, PERMISSIONS.MGR_DISCOUNTS)
      if (!auth.authorized) return err(auth.error, auth.status)

      if (!isDiscountable(order.status)) {
        return err(order.status === 'split'
            ? 'Cannot discount a split parent order — discount individual splits instead'
            : `Cannot add discount to order in '${order.status}' status`)
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
          return notFound('Discount rule not found')
        }

        if (!rule.isActive) {
          return err('This discount is not active')
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
            Number(order.inclusiveTaxRate) || undefined,
            0, // convenienceFee handled separately
            (order as any).exclusiveTaxRate != null ? Number((order as any).exclusiveTaxRate) : undefined
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

          return ok({
            toggled: 'off',
            removedDiscountId: alreadyApplied.id,
            orderTotals: {
              subtotal: totals.subtotal,
              discountTotal: totals.discountTotal,
              taxTotal: totals.taxTotal,
              total: finalTotal,
            },
          })
        }

        // Employee discount guard: if this rule is employee-only, enforce on-clock validation
        if (rule.isEmployeeDiscount) {
          if (!body.employeeId) {
            return err('Employee ID is required for employee discounts')
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
            return forbidden('Employee must be clocked in to use an employee discount')
          }
        }

        // Check max per order
        if (rule.maxPerOrder) {
          const existingCount = order.discounts.filter(
            d => d.discountRuleId === rule.id
          ).length
          if (existingCount >= rule.maxPerOrder) {
            return err(`This discount can only be applied ${rule.maxPerOrder} time(s) per order`)
          }
        }

        // Check stackability
        if (!rule.isStackable && order.discounts.length > 0) {
          return err('This discount cannot be combined with other discounts')
        }

        const config = rule.discountConfig as { type: 'percent' | 'fixed'; value: number; maxAmount?: number }
        discountName = rule.displayText
        discountRuleId = rule.id
        requiresApproval = rule.requiresApproval

        if (config.type === 'percent') {
          discountPercent = config.value
          discountAmount = roundToCents(Number(order.subtotal) * (config.value / 100))
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
          return err('Discount type and value are required')
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
              return err(`Cannot add manual discount — a non-stackable discount ("${nonStackableRule.displayText}") is already applied`)
            }
          }
        }

        // Normalize type: accept 'percent'/'PERCENTAGE'/'Percent' and 'fixed'/'FIXED'/'Fixed'/'FLAT'
        const normalizedType = body.type.toLowerCase().startsWith('percent') ? 'percent' : 'fixed'

        discountName = body.name || (normalizedType === 'percent' ? `${body.value}% Off` : `$${body.value} Off`)

        if (normalizedType === 'percent') {
          if (body.value > 100) {
            return err('Percentage cannot exceed 100%')
          }
          discountPercent = body.value
          discountAmount = roundToCents(Number(order.subtotal) * (body.value / 100))
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
          return forbidden('Approver does not have discount permission')
        }
      }

      // V6: Enforce cumulative discount cap — total discounts must never exceed subtotal (pre-tax).
      // This prevents any combination of order-level + item-level discounts from making the total negative.
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
      const totalExistingDiscounts = roundToCents(currentDiscountTotal + Number(itemLevelDiscounts._sum.amount || 0))
      const orderSubtotal = Number(order.subtotal)
      const cumulativeAfterNew = roundToCents(totalExistingDiscounts + discountAmount)

      // Reject if cumulative discounts (existing + new) would exceed the order subtotal
      if (cumulativeAfterNew > orderSubtotal) {
        return err(`Total discounts ($${cumulativeAfterNew.toFixed(2)}) would exceed order subtotal ($${orderSubtotal.toFixed(2)})`)
      }

      // Fix 4: Reject fixed discounts that exceed the full subtotal outright (don't silently clamp)
      if (discountPercent == null && discountAmount > orderSubtotal) {
        return err(`Discount amount $${discountAmount.toFixed(2)} exceeds order subtotal $${orderSubtotal.toFixed(2)}`)
      }

      if (discountAmount <= 0) {
        return err('No discount amount to apply')
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
      const totals = calculateOrderTotals(applyItems, order.location.settings as { tax?: { defaultRate?: number } }, newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt, Number(order.inclusiveTaxRate) || undefined, 0, (order as any).exclusiveTaxRate != null ? Number((order as any).exclusiveTaxRate) : undefined)

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

      return ok({
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
      })
    })

    // Transaction committed — flush outbox (fire-and-forget, catch-up handles failures)
    if (outboxLocationId) {
      flushOutboxSafe(outboxLocationId)
    }

    pushUpstream()

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
    return err('Failed to apply discount', 500)
  }
}))

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

    return ok({
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
    })
  } catch (error) {
    console.error('Failed to fetch order discounts:', error)
    return err('Failed to fetch discounts', 500)
  }
})

// DELETE - Remove a discount from an order
export const DELETE = withVenue(withAuth({ allowCellular: true }, async function DELETE(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id: orderId } = await ctx.params
    const searchParams = request.nextUrl.searchParams
    const discountId = searchParams.get('discountId')
    // SECURITY: Use authenticated employee ID for permission check, fall back to query param for business logic
    const employeeId = ctx.auth.employeeId || searchParams.get('employeeId')

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularDelete = request.headers.get('x-cellular-authenticated') === '1'
    const deleteMutationOrigin = isCellularDelete ? 'cloud' : 'local'

    if (!discountId) {
      return err('Discount ID is required')
    }

    if (!employeeId) {
      return err('Employee ID is required')
    }

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent discount removals from producing incorrect totals
      const [lockedRowDel] = await tx.$queryRaw<Array<{ id: string; locationId: string }>>`
        SELECT id, "locationId" FROM "Order" WHERE id = ${orderId} FOR UPDATE
      `
      if (!lockedRowDel) {
        return notFound('Order not found')
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
        return notFound('Order not found')
      }

      // Auth check — require manager.discounts permission
      const authResult = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_DISCOUNTS)
      if (!authResult.authorized) {
        return err(authResult.error, authResult.status ?? 403)
      }

      const discountToRemove = order.discounts.find(d => d.id === discountId)
      if (!discountToRemove) {
        return notFound('Discount not found on this order')
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
      const totals = calculateOrderTotals(deleteItems, order.location.settings as { tax?: { defaultRate?: number } }, newDiscountTotal, Number(order.tipTotal || 0), undefined, 'card', order.isTaxExempt, Number(order.inclusiveTaxRate) || undefined, 0, (order as any).exclusiveTaxRate != null ? Number((order as any).exclusiveTaxRate) : undefined)

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
      pushUpstream()
      return result.response
    }

    return result
  } catch (error) {
    console.error('Failed to remove discount:', error)
    return err('Failed to remove discount', 500)
  }
}))
