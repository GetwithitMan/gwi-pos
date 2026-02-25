import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapOrderForResponse } from '@/lib/api/order-response-mapper'
import { recalculateTotalWithTip } from '@/lib/order-calculations'
import { apiError, ERROR_CODES, getErrorMessage } from '@/lib/api/error-responses'
import { dispatchOrderTotalsUpdate, dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

// GET - Get order details
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const view = request.nextUrl.searchParams.get('view')

    // Lightweight split view — items + modifiers + totals only (no payments, tips, entertainment)
    if (view === 'split') {
      const order = await db.order.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true, orderNumber: true, status: true, orderType: true,
          subtotal: true, taxTotal: true, total: true, discountTotal: true,
          tabName: true, tableId: true, employeeId: true, locationId: true, guestCount: true,
          baseSeatCount: true, extraSeatCount: true, notes: true,
          parentOrderId: true,
          createdAt: true, updatedAt: true,
          employee: { select: { id: true, displayName: true } },
          table: { select: { id: true, name: true } },
          items: {
            where: { deletedAt: null },
            include: {
              modifiers: {
                where: { deletedAt: null },
                select: {
                  id: true, modifierId: true, name: true, price: true,
                  depth: true, preModifier: true, linkedMenuItemId: true,
                },
              },
              ingredientModifications: true,
            },
          },
        },
      })

      if (!order) {
        return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
      }

      const response = mapOrderForResponse(order)
      return NextResponse.json({ data: { ...response, paidAmount: 0 } })
    }

    // Lightweight panel view — items + modifiers only (no payments, pizzaData, ingredientModifications)
    if (view === 'panel') {
      const order = await db.order.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          guestCount: true,
          subtotal: true,
          taxTotal: true,
          total: true,
          tipTotal: true,
          discountTotal: true,
          tableId: true,
          orderType: true,
          createdAt: true,
          updatedAt: true,
          version: true,
          itemCount: true,
          baseSeatCount: true,
          extraSeatCount: true,
          employeeId: true,
          employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
          table: { select: { id: true, name: true } },
          items: {
            where: { deletedAt: null },
            select: {
              id: true,
              name: true,
              price: true,
              quantity: true,
              specialNotes: true,
              seatNumber: true,
              courseNumber: true,
              courseStatus: true,
              isHeld: true,
              kitchenStatus: true,
              status: true,
              itemTotal: true,
              menuItemId: true,
              createdAt: true,
              modifiers: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  name: true,
                  price: true,
                  depth: true,
                  preModifier: true,
                  quantity: true,
                  modifierId: true,
                },
              },
              itemDiscounts: {
                where: { deletedAt: null },
                select: { id: true, amount: true, percent: true, reason: true },
              },
            },
          },
        },
      })

      if (!order) {
        return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
      }

      // Convert Decimal fields to numbers (Prisma returns Decimal objects)
      return NextResponse.json({ data: {
        ...order,
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        total: Number(order.total),
        tipTotal: Number(order.tipTotal),
        discountTotal: Number(order.discountTotal),
        items: order.items.map(item => ({
          ...item,
          price: Number(item.price),
          itemTotal: Number(item.itemTotal),
          itemDiscounts: item.itemDiscounts.map(d => ({
            id: d.id,
            amount: Number(d.amount),
            percent: d.percent ? Number(d.percent) : null,
            reason: d.reason,
          })),
          modifiers: item.modifiers.map(mod => ({
            ...mod,
            price: Number(mod.price),
          })),
        })),
      } })
    }

    const order = await db.order.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        table: {
          select: { id: true, name: true },
        },
        items: {
          where: { deletedAt: null },
          include: {
            modifiers: {
              where: { deletedAt: null },
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
            ingredientModifications: true,
            itemDiscounts: {
              where: { deletedAt: null },
              select: { id: true, amount: true, percent: true, reason: true },
            },
          },
        },
        payments: {
          where: { deletedAt: null },
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

    return NextResponse.json({ data: {
      ...response,
      paidAmount,
      version: order.version,
    } })
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
      version,
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
      version?: number
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

    // Concurrency check: if client sent a version, verify it matches
    if (version != null && existingOrder.version !== version) {
      return NextResponse.json({
        error: 'Order was modified on another terminal',
        conflict: true,
        currentVersion: existingOrder.version,
      }, { status: 409 })
    }

    if (!['open', 'draft', 'sent', 'in_progress', 'split'].includes(existingOrder.status)) {
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
      data: { ...updateData, version: { increment: 1 } },
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
    const response = { ...mapOrderForResponse(updatedOrder), version: updatedOrder.version }

    // Dispatch order:updated for metadata changes (fire-and-forget)
    void dispatchOrderUpdated(updatedOrder.locationId, { orderId: id, changes: Object.keys(updateData) }).catch(() => {})

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

    return NextResponse.json({ data: response })
  } catch (error) {
    console.error('Failed to update order:', error)
    return apiError.internalError('Failed to update order', ERROR_CODES.INTERNAL_ERROR)
  }
})

// PATCH - Lightweight single-field metadata update (no items in response)
// Use this for quick updates like tabName, tipTotal, guestCount, notes
// Returns only order-level fields — ~60-70% faster than PUT
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Same field allowlist as PUT
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

    // Quick existence + status check (no includes)
    const existing = await db.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        locationId: true,
        subtotal: true,
        taxTotal: true,
        discountTotal: true,
      },
    })

    if (!existing) {
      return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
    }

    if (!['open', 'draft', 'sent', 'in_progress', 'split'].includes(existing.status)) {
      return apiError.conflict('Cannot modify a closed order', ERROR_CODES.ORDER_CLOSED)
    }

    // Build update data
    let newTotal = undefined
    if (tipTotal !== undefined) {
      newTotal = recalculateTotalWithTip(
        Number(existing.subtotal),
        Number(existing.taxTotal),
        Number(existing.discountTotal),
        tipTotal
      )
    }

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

    // Lightweight update — no items, no modifiers, no employee includes
    const updatedOrder = await db.order.update({
      where: { id },
      data: { ...updateData, version: { increment: 1 } },
      select: {
        id: true,
        locationId: true,
        tableId: true,
        tabName: true,
        orderNumber: true,
        guestCount: true,
        status: true,
        orderType: true,
        subtotal: true,
        taxTotal: true,
        tipTotal: true,
        discountTotal: true,
        total: true,
        commissionTotal: true,
        notes: true,
        employeeId: true,
        orderTypeId: true,
        customerId: true,
      },
    })

    // Dispatch socket update if tip changed
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

    return NextResponse.json({ data: {
      id: updatedOrder.id,
      locationId: updatedOrder.locationId,
      tableId: updatedOrder.tableId,
      tabName: updatedOrder.tabName,
      orderNumber: updatedOrder.orderNumber,
      guestCount: updatedOrder.guestCount,
      status: updatedOrder.status,
      orderType: updatedOrder.orderType,
      subtotal: Number(updatedOrder.subtotal),
      taxTotal: Number(updatedOrder.taxTotal),
      tipTotal: Number(updatedOrder.tipTotal),
      discountTotal: Number(updatedOrder.discountTotal),
      total: Number(updatedOrder.total),
      notes: updatedOrder.notes,
    } })
  } catch (error) {
    console.error('Failed to patch order:', error)
    return apiError.internalError('Failed to update order', ERROR_CODES.INTERNAL_ERROR)
  }
})
