import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapOrderForResponse } from '@/lib/api/order-response-mapper'
import { recalculateTotalWithTip } from '@/lib/order-calculations'
import { apiError, ERROR_CODES, getErrorMessage } from '@/lib/api/error-responses'
import { dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

// GET - Get order details
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const order = await db.order.findUnique({
      where: { id },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        table: {
          select: { id: true, name: true },
        },
        items: {
          include: {
            modifiers: {
              select: {
                id: true,
                modifierId: true,
                name: true,
                price: true,
                depth: true,
                preModifier: true,
                linkedMenuItemId: true,
              },
            },
            pizzaData: true,
          },
        },
        payments: {
          select: {
            id: true,
            paymentMethod: true,
            amount: true,
            tipAmount: true,
            totalAmount: true,
            status: true,
            cardLast4: true,
            cardBrand: true,
            roundingAdjustment: true,
          },
        },
      },
    })

    if (!order) {
      return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
    }

    // Use mapper for complete response with all modifier fields
    const response = mapOrderForResponse(order)

    const paidAmount = (order.payments as { status: string; totalAmount: unknown }[])
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.totalAmount), 0)

    return NextResponse.json({
      ...response,
      paidAmount,
    })
  } catch (error) {
    console.error('Failed to fetch order:', error)
    return apiError.internalError('Failed to fetch order', ERROR_CODES.INTERNAL_ERROR)
  }
})

// PUT - Update order METADATA only (NO items)
// For item updates, use POST /api/orders/[id]/items instead
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // ❌ REJECT if items are included
    if (body.items && Array.isArray(body.items) && body.items.length > 0) {
      return apiError.badRequest(
        'DEPRECATED: Cannot update items via PUT. Use POST /api/orders/[id]/items instead.',
        ERROR_CODES.PUT_WITH_ITEMS_DEPRECATED,
        {
          hint: 'Switch to POST /api/orders/[id]/items for item updates to prevent race conditions',
          migration: {
            old: 'PUT /api/orders/[id] with { items: [...] }',
            new: 'POST /api/orders/[id]/items with { items: [...] }'
          }
        }
      )
    }

    const {
      tabName,
      guestCount,
      notes,
      tipTotal,
      tableId,
      orderTypeId,
      customerId,
      status,
      employeeId,
    } = body as {
      tabName?: string
      guestCount?: number
      notes?: string
      tipTotal?: number
      tableId?: string
      orderTypeId?: string
      customerId?: string
      status?: string
      employeeId?: string
    }

    // Get existing order
    const existingOrder = await db.order.findUnique({
      where: { id },
      include: {
        location: true,
        items: true,
      },
    })

    if (!existingOrder) {
      return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
    }

    if (existingOrder.status !== 'open' && existingOrder.status !== 'draft') {
      return apiError.conflict('Cannot modify a closed order', ERROR_CODES.ORDER_CLOSED)
    }

    // ✅ ALLOW metadata updates only
    // Calculate new total if tipTotal is being updated (uses centralized function)
    let newTotal = undefined
    if (tipTotal !== undefined) {
      const subtotal = Number(existingOrder.subtotal)
      const taxTotal = Number(existingOrder.taxTotal)
      const discountTotal = Number(existingOrder.discountTotal)
      newTotal = recalculateTotalWithTip(subtotal, taxTotal, discountTotal, tipTotal)
    }

    // Build update data object with only defined fields
    const updateData: Record<string, any> = {}
    if (tabName !== undefined) updateData.tabName = tabName
    if (guestCount !== undefined) updateData.guestCount = guestCount
    if (notes !== undefined) updateData.notes = notes
    if (tipTotal !== undefined) updateData.tipTotal = tipTotal
    if (newTotal !== undefined) updateData.total = newTotal
    if (tableId !== undefined) updateData.tableId = tableId
    if (orderTypeId !== undefined) updateData.orderTypeId = orderTypeId
    if (customerId !== undefined) updateData.customerId = customerId
    if (employeeId !== undefined) updateData.employeeId = employeeId
    if (status !== undefined) {
      updateData.status = status
      if (status === 'cancelled' || status === 'closed') {
        updateData.closedAt = new Date()
      }
    }

    const updatedOrder = await db.order.update({
      where: { id },
      data: updateData,
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        items: {
          include: {
            modifiers: true,
            ingredientModifications: true,
          },
        },
      },
    })

    // Use mapper for complete response with all modifier fields
    const response = mapOrderForResponse(updatedOrder)

    // FIX-011: Dispatch real-time totals update if tip changed (fire-and-forget)
    if (tipTotal !== undefined) {
      dispatchOrderTotalsUpdate(updatedOrder.locationId, updatedOrder.id, {
        subtotal: Number(updatedOrder.subtotal),
        taxTotal: Number(updatedOrder.taxTotal),
        tipTotal: Number(updatedOrder.tipTotal),
        discountTotal: Number(updatedOrder.discountTotal),
        total: Number(updatedOrder.total),
        commissionTotal: Number(updatedOrder.commissionTotal || 0),
      }, { async: true }).catch(console.error)
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to update order:', error)
    return apiError.internalError('Failed to update order', ERROR_CODES.INTERNAL_ERROR)
  }
})
