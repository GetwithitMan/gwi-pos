import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateOrderTotals } from '@/lib/order-calculations'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate, dispatchOrderUpdated, dispatchOpenOrdersChanged, dispatchOrderSummaryUpdated, buildOrderSummary } from '@/lib/socket-dispatch'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { roundToCents } from '@/lib/pricing'

/**
 * POST — Mark an order as tax-exempt with reason and optional tax ID.
 * Requires manager.tax_exempt permission.
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { reason, taxId } = body as { reason?: string; taxId?: string }
    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId || body.employeeId

    if (!reason || reason.trim().length === 0) {
      return NextResponse.json({ error: 'Tax exempt reason is required' }, { status: 400 })
    }

    if (reason.length > 200) {
      return NextResponse.json({ error: 'Reason cannot exceed 200 characters' }, { status: 400 })
    }

    if (taxId && taxId.length > 50) {
      return NextResponse.json({ error: 'Tax ID cannot exceed 50 characters' }, { status: 400 })
    }

    // Fetch order with items for recalculation
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        isTaxExempt: true,
        taxTotal: true,
        subtotal: true,
        discountTotal: true,
        tipTotal: true,
        total: true,
        inclusiveTaxRate: true,
        status: true,
        items: {
          where: { deletedAt: null, status: 'active' },
          select: {
            price: true,
            quantity: true,
            isTaxInclusive: true,
            status: true,
            modifiers: { where: { deletedAt: null }, select: { price: true, quantity: true } },
            commissionAmount: true,
          },
        },
        location: { select: { settings: true } },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Permission check
    const auth = await requirePermission(requestingEmployeeId, order.locationId, PERMISSIONS.MGR_TAX_EXEMPT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Guard: cannot modify paid/closed orders
    if (['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) {
      return NextResponse.json({ error: 'Cannot modify a closed order' }, { status: 400 })
    }

    // Already exempt — return early
    if (order.isTaxExempt) {
      return NextResponse.json({ data: { success: true, alreadyExempt: true } })
    }

    // Calculate the tax that would be saved (for audit)
    const currentTaxTotal = roundToCents(Number(order.taxTotal ?? 0))

    // Recalculate with tax exempt
    const orderTotals = calculateOrderTotals(
      order.items.map(i => ({
        price: Number(i.price),
        quantity: i.quantity,
        isTaxInclusive: i.isTaxInclusive ?? false,
        status: i.status,
        modifiers: (i.modifiers ?? []).map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
        commissionAmount: Number(i.commissionAmount ?? 0),
      })),
      order.location.settings as Record<string, unknown> | null,
      Number(order.discountTotal ?? 0),
      Number(order.tipTotal ?? 0),
      undefined,
      'card',
      true, // isTaxExempt
      Number(order.inclusiveTaxRate) || undefined
    )

    // Update order
    const updated = await db.order.update({
      where: { id: orderId },
      data: {
        isTaxExempt: true,
        taxExemptReason: reason.trim(),
        taxExemptId: taxId?.trim() || null,
        taxExemptApprovedBy: requestingEmployeeId || null,
        taxExemptSavedAmount: currentTaxTotal,
        taxTotal: orderTotals.taxTotal,
        taxFromInclusive: orderTotals.taxFromInclusive,
        taxFromExclusive: orderTotals.taxFromExclusive,
        total: orderTotals.total,
        lastMutatedBy: 'local',
      },
      select: {
        id: true,
        isTaxExempt: true,
        taxExemptReason: true,
        taxExemptId: true,
        taxExemptApprovedBy: true,
        taxExemptSavedAmount: true,
        taxTotal: true,
        total: true,
        subtotal: true,
        discountTotal: true,
        tipTotal: true,
        locationId: true,
        orderNumber: true,
        tabName: true,
        guestCount: true,
        employeeId: true,
        tableId: true,
        table: { select: { name: true } },
        status: true,
        updatedAt: true,
      },
    })

    // Emit order event
    void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', {
      changes: ['isTaxExempt', 'taxExemptReason', 'taxExemptId', 'taxTotal', 'total'],
    }).catch(console.error)

    // Socket dispatch for cross-terminal sync
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: Number(updated.subtotal),
      taxTotal: Number(updated.taxTotal),
      tipTotal: Number(updated.tipTotal),
      discountTotal: Number(updated.discountTotal),
      total: Number(updated.total),
      commissionTotal: 0,
    }, { async: true }).catch(console.error)
    void dispatchOrderUpdated(order.locationId, { orderId, changes: ['isTaxExempt'] }).catch(console.error)
    void dispatchOpenOrdersChanged(order.locationId, { trigger: 'updated', orderId }, { async: true }).catch(console.error)
    void dispatchOrderSummaryUpdated(order.locationId, buildOrderSummary(updated), { async: true }).catch(console.error)

    // Upstream sync
    pushUpstream()

    return NextResponse.json({
      data: {
        success: true,
        isTaxExempt: true,
        taxExemptReason: updated.taxExemptReason,
        taxExemptId: updated.taxExemptId,
        taxExemptSavedAmount: Number(updated.taxExemptSavedAmount),
        taxTotal: Number(updated.taxTotal),
        total: Number(updated.total),
      },
    })
  } catch (error) {
    console.error('Tax exempt POST error:', error)
    return NextResponse.json({ error: 'Failed to set tax exemption' }, { status: 500 })
  }
})

/**
 * DELETE — Remove tax-exempt status from an order.
 * Requires manager.tax_exempt permission.
 */
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId ||
      request.nextUrl.searchParams.get('employeeId')

    // Fetch order with items for recalculation
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        isTaxExempt: true,
        subtotal: true,
        discountTotal: true,
        tipTotal: true,
        total: true,
        inclusiveTaxRate: true,
        status: true,
        items: {
          where: { deletedAt: null, status: 'active' },
          select: {
            price: true,
            quantity: true,
            isTaxInclusive: true,
            status: true,
            modifiers: { where: { deletedAt: null }, select: { price: true, quantity: true } },
            commissionAmount: true,
          },
        },
        location: { select: { settings: true } },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Permission check
    const auth = await requirePermission(requestingEmployeeId, order.locationId, PERMISSIONS.MGR_TAX_EXEMPT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Guard: cannot modify paid/closed orders
    if (['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) {
      return NextResponse.json({ error: 'Cannot modify a closed order' }, { status: 400 })
    }

    // Not exempt — return early
    if (!order.isTaxExempt) {
      return NextResponse.json({ data: { success: true, alreadyNotExempt: true } })
    }

    // Recalculate with tax re-applied
    const orderTotals = calculateOrderTotals(
      order.items.map(i => ({
        price: Number(i.price),
        quantity: i.quantity,
        isTaxInclusive: i.isTaxInclusive ?? false,
        status: i.status,
        modifiers: (i.modifiers ?? []).map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
        commissionAmount: Number(i.commissionAmount ?? 0),
      })),
      order.location.settings as Record<string, unknown> | null,
      Number(order.discountTotal ?? 0),
      Number(order.tipTotal ?? 0),
      undefined,
      'card',
      false, // isTaxExempt = false
      Number(order.inclusiveTaxRate) || undefined
    )

    // Update order — clear all exempt fields
    const updated = await db.order.update({
      where: { id: orderId },
      data: {
        isTaxExempt: false,
        taxExemptReason: null,
        taxExemptId: null,
        taxExemptApprovedBy: null,
        taxExemptSavedAmount: null,
        taxTotal: orderTotals.taxTotal,
        taxFromInclusive: orderTotals.taxFromInclusive,
        taxFromExclusive: orderTotals.taxFromExclusive,
        total: orderTotals.total,
        lastMutatedBy: 'local',
      },
      select: {
        id: true,
        isTaxExempt: true,
        taxTotal: true,
        total: true,
        subtotal: true,
        discountTotal: true,
        tipTotal: true,
        locationId: true,
        orderNumber: true,
        tabName: true,
        guestCount: true,
        employeeId: true,
        tableId: true,
        table: { select: { name: true } },
        status: true,
        updatedAt: true,
      },
    })

    // Emit order event
    void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', {
      changes: ['isTaxExempt', 'taxExemptReason', 'taxExemptId', 'taxTotal', 'total'],
    }).catch(console.error)

    // Socket dispatch
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: Number(updated.subtotal),
      taxTotal: Number(updated.taxTotal),
      tipTotal: Number(updated.tipTotal),
      discountTotal: Number(updated.discountTotal),
      total: Number(updated.total),
      commissionTotal: 0,
    }, { async: true }).catch(console.error)
    void dispatchOrderUpdated(order.locationId, { orderId, changes: ['isTaxExempt'] }).catch(console.error)
    void dispatchOpenOrdersChanged(order.locationId, { trigger: 'updated', orderId }, { async: true }).catch(console.error)
    void dispatchOrderSummaryUpdated(order.locationId, buildOrderSummary(updated), { async: true }).catch(console.error)

    // Upstream sync
    pushUpstream()

    return NextResponse.json({
      data: {
        success: true,
        isTaxExempt: false,
        taxTotal: Number(updated.taxTotal),
        total: Number(updated.total),
      },
    })
  } catch (error) {
    console.error('Tax exempt DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove tax exemption' }, { status: 500 })
  }
})
