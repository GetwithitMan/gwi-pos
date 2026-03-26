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
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('orders-tax-exempt')

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

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularTaxExempt = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularTaxExempt ? 'cloud' : 'local'

    if (!reason || reason.trim().length === 0) {
      return NextResponse.json({ error: 'Tax exempt reason is required' }, { status: 400 })
    }

    if (reason.length > 200) {
      return NextResponse.json({ error: 'Reason cannot exceed 200 characters' }, { status: 400 })
    }

    if (taxId && taxId.length > 50) {
      return NextResponse.json({ error: 'Tax ID cannot exceed 50 characters' }, { status: 400 })
    }

    // Wrap read-calculate-update in a transaction with FOR UPDATE to prevent lost updates
    const updated = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent tax-exempt toggles from producing incorrect totals
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      // Fetch order with items for recalculation
      const order = await tx.order.findUnique({
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
          donationAmount: true,
          convenienceFee: true,
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
        return { error: 'Order not found', status: 404 } as const
      }

      // Permission check
      const auth = await requirePermission(requestingEmployeeId, order.locationId, PERMISSIONS.MGR_TAX_EXEMPT)
      if (!auth.authorized) {
        return { error: auth.error, status: auth.status } as const
      }

      // Guard: cannot modify paid/closed orders
      if (['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) {
        return { error: 'Cannot modify a closed order', status: 400 } as const
      }

      // Already exempt — return early
      if (order.isTaxExempt) {
        return { earlyReturn: true } as const
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

      const exemptDonation = Number(order.donationAmount || 0)
      const exemptConvFee = Number(order.convenienceFee || 0)
      const exemptFinalTotal = exemptDonation > 0 || exemptConvFee > 0
        ? roundToCents(orderTotals.total + exemptDonation + exemptConvFee)
        : orderTotals.total

      // Update order
      const result = await tx.order.update({
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
          total: exemptFinalTotal,
          lastMutatedBy: mutationOrigin,
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

      return { data: result, locationId: order.locationId }
    })

    // Handle transaction results
    if ('error' in updated) {
      return NextResponse.json({ error: updated.error }, { status: updated.status })
    }
    if ('earlyReturn' in updated) {
      return NextResponse.json({ data: { success: true, alreadyExempt: true } })
    }

    const { data: updatedOrder, locationId } = updated

    // Emit order event
    void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
      changes: ['isTaxExempt', 'taxExemptReason', 'taxExemptId', 'taxTotal', 'total'],
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Socket dispatch for cross-terminal sync
    void dispatchOrderTotalsUpdate(locationId, orderId, {
      subtotal: Number(updatedOrder.subtotal),
      taxTotal: Number(updatedOrder.taxTotal),
      tipTotal: Number(updatedOrder.tipTotal),
      discountTotal: Number(updatedOrder.discountTotal),
      total: Number(updatedOrder.total),
      commissionTotal: 0,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchOrderUpdated(locationId, { orderId, changes: ['isTaxExempt'] }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchOpenOrdersChanged(locationId, { trigger: 'updated', orderId }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchOrderSummaryUpdated(locationId, buildOrderSummary(updatedOrder), { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    // Upstream sync
    pushUpstream()

    return NextResponse.json({
      data: {
        success: true,
        isTaxExempt: true,
        taxExemptReason: updatedOrder.taxExemptReason,
        taxExemptId: updatedOrder.taxExemptId,
        taxExemptSavedAmount: Number(updatedOrder.taxExemptSavedAmount),
        taxTotal: Number(updatedOrder.taxTotal),
        total: Number(updatedOrder.total),
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

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularDeleteTaxExempt = request.headers.get('x-cellular-authenticated') === '1'
    const deleteMutationOrigin = isCellularDeleteTaxExempt ? 'cloud' : 'local'

    // Wrap read-calculate-update in a transaction with FOR UPDATE to prevent lost updates
    const deleteResult = await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent tax-exempt toggles from producing incorrect totals
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      // Fetch order with items for recalculation
      const order = await tx.order.findUnique({
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
          donationAmount: true,
          convenienceFee: true,
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
        return { error: 'Order not found', status: 404 } as const
      }

      // Permission check
      const auth = await requirePermission(requestingEmployeeId, order.locationId, PERMISSIONS.MGR_TAX_EXEMPT)
      if (!auth.authorized) {
        return { error: auth.error, status: auth.status } as const
      }

      // Guard: cannot modify paid/closed orders
      if (['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) {
        return { error: 'Cannot modify a closed order', status: 400 } as const
      }

      // Not exempt — return early
      if (!order.isTaxExempt) {
        return { earlyReturn: true } as const
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

      const reapplyDonation = Number(order.donationAmount || 0)
      const reapplyConvFee = Number(order.convenienceFee || 0)
      const reapplyFinalTotal = reapplyDonation > 0 || reapplyConvFee > 0
        ? roundToCents(orderTotals.total + reapplyDonation + reapplyConvFee)
        : orderTotals.total

      // Update order — clear all exempt fields
      const result = await tx.order.update({
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
          total: reapplyFinalTotal,
          lastMutatedBy: deleteMutationOrigin,
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

      return { data: result, locationId: order.locationId }
    })

    // Handle transaction results
    if ('error' in deleteResult) {
      return NextResponse.json({ error: deleteResult.error }, { status: deleteResult.status })
    }
    if ('earlyReturn' in deleteResult) {
      return NextResponse.json({ data: { success: true, alreadyNotExempt: true } })
    }

    const { data: updated, locationId: delLocationId } = deleteResult

    // Emit order event
    void emitOrderEvent(delLocationId, orderId, 'ORDER_METADATA_UPDATED', {
      changes: ['isTaxExempt', 'taxExemptReason', 'taxExemptId', 'taxTotal', 'total'],
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Socket dispatch
    void dispatchOrderTotalsUpdate(delLocationId, orderId, {
      subtotal: Number(updated.subtotal),
      taxTotal: Number(updated.taxTotal),
      tipTotal: Number(updated.tipTotal),
      discountTotal: Number(updated.discountTotal),
      total: Number(updated.total),
      commissionTotal: 0,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchOrderUpdated(delLocationId, { orderId, changes: ['isTaxExempt'] }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchOpenOrdersChanged(delLocationId, { trigger: 'updated', orderId }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchOrderSummaryUpdated(delLocationId, buildOrderSummary(updated), { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

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
