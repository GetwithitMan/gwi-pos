import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { mapOrderForResponse } from '@/lib/api/order-response-mapper'
import { recalculateTotalWithTip, calculateOrderTotals } from '@/lib/order-calculations'
import { calculateCardPrice, roundToCents } from '@/lib/pricing'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { apiError, ERROR_CODES } from '@/lib/api/error-responses'
import { dispatchOrderTotalsUpdate, dispatchOrderUpdated, dispatchFloorPlanUpdate, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { validateTransition, isModifiable } from '@/lib/domain/order-status'
import { getRequestLocationId } from '@/lib/request-context'

// GET - Get order details
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const view = request.nextUrl.searchParams.get('view')

    // Auth check deferred — resolved from the order record after fetch (eliminates double-fetch)
    const requestingEmployeeId = request.headers.get('x-employee-id') || request.nextUrl.searchParams.get('requestingEmployeeId')

    // Lightweight split view — items + modifiers + totals only (no payments, tips, entertainment)
    // TODO: migrate to OrderRepository once a getOrderForSplitView() method exists
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
    // TODO: add repository method for panel view shape (getOrderForPanelView)
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
          taxFromInclusive: true,
          taxFromExclusive: true,
          total: true,
          tipTotal: true,
          discountTotal: true,
          tableId: true,
          locationId: true,
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
              pricingOptionLabel: true,
              blockTimeMinutes: true,
              blockTimeStartedAt: true,
              blockTimeExpiresAt: true,
              menuItem: { select: { itemType: true } },
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

      // Compute server-authoritative cash/card totals
      // Uses stored taxFromInclusive/taxFromExclusive to correctly handle tax-inclusive items.
      // Inclusive-tax items have tax baked into the price — simple `sub * taxRate` double-counts.
      let panelCashTotal = Number(order.total)
      let panelCardTotal = Number(order.total)
      let panelCashDiscountPercent = 0
      try {
        const locSettings = await getLocationSettings(order.locationId)
        const parsed = parseSettings(locSettings as Record<string, unknown>)
        const dp = parsed?.dualPricing
        if (dp?.enabled) {
          panelCashDiscountPercent = dp.cashDiscountPercent ?? 4.0
          const sub = Number(order.subtotal)
          const disc = Number(order.discountTotal || 0)
          const discountedCashSub = Math.max(0, sub - disc)
          const cardSub = calculateCardPrice(sub, panelCashDiscountPercent)
          const discountedCardSub = Math.max(0, cardSub - disc)
          const taxRate = (parsed?.tax?.defaultRate ?? 0) / 100
          const storedTaxInc = Number(order.taxFromInclusive) || 0
          const storedTaxExc = Number(order.taxFromExclusive) || 0
          const storedTaxTotal = storedTaxInc + storedTaxExc
          // Use the stored inclusive/exclusive ratio to split the tax correctly
          const excRatio = storedTaxTotal > 0 ? storedTaxExc / storedTaxTotal : 1
          // Cash: inclusive portion stays as-is (baked into price), only exclusive portion scales with subtotal
          const cashTax = roundToCents(storedTaxInc + (discountedCashSub * taxRate * excRatio))
          // Card: apply surcharge then compute tax on the exclusive portion
          const cardTax = roundToCents(storedTaxInc + (discountedCardSub * taxRate * excRatio))
          panelCashTotal = roundToCents(discountedCashSub + cashTax)
          panelCardTotal = roundToCents(discountedCardSub + cardTax)
        }
      } catch {
        // Settings unavailable — fall back to order.total
      }

      // Convert Decimal fields to numbers (Prisma returns Decimal objects)
      return NextResponse.json({ data: {
        ...order,
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        total: Number(order.total),
        tipTotal: Number(order.tipTotal),
        discountTotal: Number(order.discountTotal),
        cashTotal: panelCashTotal,
        cardTotal: panelCardTotal,
        cashDiscountPercent: panelCashDiscountPercent,
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

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      const getLocationCheck = await db.order.findFirst({
        where: { id, deletedAt: null },
        select: { locationId: true },
      })
      if (!getLocationCheck) {
        return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
      }
      locationId = getLocationCheck.locationId
    }

    const order = await OrderRepository.getOrderByIdWithInclude(id, locationId, {
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
            menuItem: { select: { itemType: true } },
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
    })

    if (!order) {
      return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
    }

    // Auth check — deferred to after fetch to eliminate double-fetch
    if (requestingEmployeeId) {
      const auth = await requirePermission(requestingEmployeeId, order.locationId, PERMISSIONS.POS_ACCESS)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Use mapper for complete response with all modifier fields
    const response = mapOrderForResponse(order)

    const paidAmount = (order.payments as { status: string; totalAmount: unknown }[])
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.totalAmount), 0)

    // Compute server-authoritative cash/card totals so clients don't need to recalculate
    // (prevents discrepancies from different client-side tax+dual pricing calculation orders)
    let cashTotal = Number(order.total)
    let cardTotal = Number(order.total)
    let cashDiscountPercent = 0
    try {
      const locSettings = await getLocationSettings(order.locationId)
      const parsed = parseSettings(locSettings as Record<string, unknown>)
      const dualPricing = parsed?.dualPricing
      if (dualPricing?.enabled) {
        cashDiscountPercent = dualPricing.cashDiscountPercent ?? 4.0
        const cashSub = Number(order.subtotal)
        const disc = Number(order.discountTotal || 0)
        const discountedCashSub = Math.max(0, cashSub - disc)
        const cardSub = calculateCardPrice(cashSub, cashDiscountPercent)
        const discountedCardSub = Math.max(0, cardSub - disc)
        const taxRate = (parsed?.tax?.defaultRate ?? 0) / 100
        const storedTaxInc = Number((order as any).taxFromInclusive) || 0
        const storedTaxExc = Number((order as any).taxFromExclusive) || 0
        const storedTaxTotal = storedTaxInc + storedTaxExc
        // Use the stored inclusive/exclusive ratio to split the tax correctly
        const excRatio = storedTaxTotal > 0 ? storedTaxExc / storedTaxTotal : 1
        // Cash: inclusive portion stays as-is (baked into price), only exclusive portion scales with subtotal
        const cashTax = roundToCents(storedTaxInc + (discountedCashSub * taxRate * excRatio))
        // Card: apply surcharge then compute tax on the exclusive portion
        const cardTax = roundToCents(storedTaxInc + (discountedCardSub * taxRate * excRatio))
        cashTotal = roundToCents(discountedCashSub + cashTax)
        cardTotal = roundToCents(discountedCardSub + cardTax)
      }
    } catch {
      // Settings unavailable — fall back to order.total for both
    }

    return NextResponse.json({ data: {
      ...response,
      paidAmount,
      version: order.version,
      cashTotal,
      cardTotal,
      cashDiscountPercent,
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
      isTaxExempt,
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
      isTaxExempt?: boolean
    }

    // Input validation for fields that bypass Zod
    if (tipTotal !== undefined && tipTotal !== null && Number(tipTotal) < 0) {
      return NextResponse.json({ error: 'Tip total cannot be negative' }, { status: 400 })
    }
    if (tabName !== undefined && tabName !== null && tabName.length > 50) {
      return NextResponse.json({ error: 'Tab name cannot exceed 50 characters' }, { status: 400 })
    }
    if (notes !== undefined && notes !== null && notes.length > 500) {
      return NextResponse.json({ error: 'Notes cannot exceed 500 characters' }, { status: 400 })
    }

    // Cellular ownership gating — block mutation of locally-owned orders
    const isCellularPut = request.headers.get('x-cellular-authenticated') === '1'
    if (isCellularPut) {
      const { validateCellularOrderAccess, CellularAuthError } = await import('@/lib/cellular-validation')
      try {
        await validateCellularOrderAccess(true, id, 'mutate', db)
      } catch (err) {
        if (err instanceof CellularAuthError) {
          return NextResponse.json({ error: err.message }, { status: err.status })
        }
        throw err
      }
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let resolvedLocationId = getRequestLocationId()
    if (!resolvedLocationId) {
      const orderLocationCheck = await db.order.findFirst({
        where: { id },
        select: { locationId: true },
      })
      if (!orderLocationCheck) {
        return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
      }
      resolvedLocationId = orderLocationCheck.locationId
    }

    const existingOrder = await OrderRepository.getOrderByIdWithSelect(id, resolvedLocationId, {
        id: true,
        status: true,
        locationId: true,
        subtotal: true,
        taxTotal: true,
        discountTotal: true,
        tipTotal: true,
        total: true,
        isTaxExempt: true,
        inclusiveTaxRate: true,
        version: true,
        employeeId: true,
        location: { select: { settings: true } },
        items: {
          where: { deletedAt: null, status: 'active' },
          select: {
            price: true,
            quantity: true,
            isTaxInclusive: true,
            status: true,
            commissionAmount: true,
            modifiers: {
              where: { deletedAt: null },
              select: { price: true },
            },
          },
        },
    })

    if (!existingOrder) {
      return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
    }

    // Auth check — require POS access for order edits
    const requestingEmployeeId = request.headers.get('x-employee-id') || body.requestingEmployeeId || body.employeeId
    if (requestingEmployeeId) {
      const auth = await requirePermission(requestingEmployeeId, existingOrder.locationId, PERMISSIONS.POS_ACCESS)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
      // Elevated checks for sensitive field changes
      if (tableId !== undefined) {
        const tAuth = await requirePermission(requestingEmployeeId, existingOrder.locationId, PERMISSIONS.POS_CHANGE_TABLE)
        if (!tAuth.authorized) return NextResponse.json({ error: tAuth.error }, { status: tAuth.status })
      }
      if (employeeId !== undefined && employeeId !== requestingEmployeeId) {
        const sAuth = await requirePermission(requestingEmployeeId, existingOrder.locationId, PERMISSIONS.POS_CHANGE_SERVER)
        if (!sAuth.authorized) return NextResponse.json({ error: sAuth.error }, { status: sAuth.status })
      }
      if (isTaxExempt !== undefined) {
        const txAuth = await requirePermission(requestingEmployeeId, existingOrder.locationId, PERMISSIONS.MGR_TAX_EXEMPT)
        if (!txAuth.authorized) return NextResponse.json({ error: txAuth.error }, { status: txAuth.status })
      }
    }

    // Concurrency check: if client sent a version, verify it matches
    if (version != null && existingOrder.version !== version) {
      return NextResponse.json({
        error: 'Order was modified on another terminal',
        conflict: true,
        currentVersion: existingOrder.version,
      }, { status: 409 })
    }

    if (!isModifiable(existingOrder.status)) {
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

    // Recalculate totals when tax exemption status changes
    let taxExemptTotals: { taxTotal: number; total: number; taxFromInclusive: number; taxFromExclusive: number } | undefined
    if (isTaxExempt !== undefined && isTaxExempt !== existingOrder.isTaxExempt) {
      const orderTotals = calculateOrderTotals(
        existingOrder.items.filter(i => i.status === 'active').map(i => ({
          price: Number(i.price),
          quantity: i.quantity,
          isTaxInclusive: i.isTaxInclusive ?? false,
          status: i.status,
          modifiers: (i.modifiers ?? []).map(m => ({ price: Number(m.price) })),
          commissionAmount: Number(i.commissionAmount ?? 0),
        })),
        existingOrder.location.settings as { tax?: { defaultRate?: number } },
        Number(existingOrder.discountTotal),
        Number(existingOrder.tipTotal ?? 0),
        undefined,
        'card',
        isTaxExempt,
        Number(existingOrder.inclusiveTaxRate) || undefined
      )
      taxExemptTotals = {
        taxTotal: orderTotals.taxTotal,
        total: orderTotals.total,
        taxFromInclusive: orderTotals.taxFromInclusive,
        taxFromExclusive: orderTotals.taxFromExclusive,
      }
    }

    // Build update data object with only defined fields
    const updateData: Record<string, any> = {}
    if (tabName !== undefined) updateData.tabName = tabName
    if (guestCount !== undefined) updateData.guestCount = guestCount
    if (notes !== undefined) updateData.notes = notes
    if (tipTotal !== undefined) updateData.tipTotal = tipTotal
    if (newTotal !== undefined) updateData.total = newTotal
    if (isTaxExempt !== undefined) {
      updateData.isTaxExempt = isTaxExempt
      if (taxExemptTotals) {
        updateData.taxTotal = taxExemptTotals.taxTotal
        updateData.taxFromInclusive = taxExemptTotals.taxFromInclusive
        updateData.taxFromExclusive = taxExemptTotals.taxFromExclusive
        updateData.total = taxExemptTotals.total
      }
    }
    if (tableId !== undefined) updateData.tableId = tableId
    if (orderTypeId !== undefined) updateData.orderTypeId = orderTypeId
    if (customerId !== undefined) updateData.customerId = customerId
    if (employeeId !== undefined) updateData.employeeId = employeeId
    if (status !== undefined) {
      // Status transition validation — single source of truth in domain module
      const transition = validateTransition(existingOrder.status, status)
      if (!transition.valid) {
        return apiError.badRequest(transition.error!, ERROR_CODES.INVALID_ORDER_STATUS)
      }

      updateData.status = status
      if (status === 'cancelled' || status === 'closed') {
        updateData.closedAt = new Date()
      }
    }

    const updatedOrder = await OrderRepository.updateOrderAndSelect(
      id,
      existingOrder.locationId,
      { ...updateData, version: { increment: 1 } },
      {
        id: true,
        locationId: true,
        orderNumber: true,
        status: true,
        orderType: true,
        tableId: true,
        tabName: true,
        guestCount: true,
        subtotal: true,
        taxTotal: true,
        tipTotal: true,
        discountTotal: true,
        total: true,
        commissionTotal: true,
        notes: true,
        employeeId: true,
        version: true,
        isTaxExempt: true,
        createdAt: true,
        updatedAt: true,
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
      },
    )

    if (!updatedOrder) {
      return apiError.notFound('Order not found after update', ERROR_CODES.ORDER_NOT_FOUND)
    }

    // Build lightweight response (metadata-only update — no items needed)
    const response = {
      id: updatedOrder.id,
      locationId: updatedOrder.locationId,
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      orderType: updatedOrder.orderType,
      tableId: updatedOrder.tableId,
      tabName: updatedOrder.tabName,
      guestCount: updatedOrder.guestCount,
      subtotal: Number(updatedOrder.subtotal),
      taxTotal: Number(updatedOrder.taxTotal),
      tipTotal: Number(updatedOrder.tipTotal),
      discountTotal: Number(updatedOrder.discountTotal),
      total: Number(updatedOrder.total),
      notes: updatedOrder.notes,
      employeeId: updatedOrder.employeeId,
      version: updatedOrder.version,
      isTaxExempt: updatedOrder.isTaxExempt,
      employee: updatedOrder.employee ? {
        id: updatedOrder.employee.id,
        name: updatedOrder.employee.displayName || `${updatedOrder.employee.firstName} ${updatedOrder.employee.lastName}`,
      } : null,
    }

    // Dispatch order:updated for metadata changes (fire-and-forget)
    void dispatchOrderUpdated(updatedOrder.locationId, { orderId: id, changes: Object.keys(updateData) }).catch(() => {})

    // Emit order events for metadata changes (fire-and-forget)
    const orderEvents: Array<{ type: 'GUEST_COUNT_CHANGED' | 'NOTE_CHANGED' | 'ORDER_METADATA_UPDATED' | 'ORDER_CLOSED'; payload: Record<string, unknown> }> = []
    if (guestCount !== undefined) {
      orderEvents.push({ type: 'GUEST_COUNT_CHANGED', payload: { count: guestCount } })
    }
    if (notes !== undefined) {
      orderEvents.push({ type: 'NOTE_CHANGED', payload: { note: notes } })
    }
    if (tabName !== undefined || tableId !== undefined || employeeId !== undefined) {
      const metaPayload: Record<string, unknown> = {}
      if (tabName !== undefined) metaPayload.tabName = tabName
      if (tableId !== undefined) metaPayload.tableId = tableId
      if (employeeId !== undefined) metaPayload.employeeId = employeeId
      orderEvents.push({ type: 'ORDER_METADATA_UPDATED', payload: metaPayload })
    }
    if (status !== undefined && ['closed', 'void', 'cancelled'].includes(status)) {
      orderEvents.push({ type: 'ORDER_CLOSED', payload: { closedStatus: status } })
    }
    if (orderEvents.length > 0) {
      void emitOrderEvents(updatedOrder.locationId, id, orderEvents)
    }

    // Auto-stop entertainment sessions when order is voided/cancelled/closed
    // TODO: migrate to MenuItemRepository/FloorPlanElementRepository once those repos exist
    // (queries use currentOrderId filter + relation-filter menuItem.itemType, not supported by current repos)
    if (status !== undefined && ['voided', 'cancelled', 'closed'].includes(status)) {
      void (async () => {
        try {
          // TODO: migrate to MenuItemRepository/FloorPlanElementRepository once those repos exist
          const entertainmentItems = await db.menuItem.findMany({
            where: { currentOrderId: id, itemType: 'timed_rental' },
            select: { id: true, name: true },
          })

          if (entertainmentItems.length > 0) {
            // Clear blockTimeStartedAt on order items so Android stops showing timers
            await db.orderItem.updateMany({
              where: { orderId: id, menuItem: { itemType: 'timed_rental' }, blockTimeStartedAt: { not: null } },
              data: { blockTimeStartedAt: null },
            })

            await db.menuItem.updateMany({
              where: { currentOrderId: id, itemType: 'timed_rental' },
              data: {
                entertainmentStatus: 'available',
                currentOrderId: null,
                currentOrderItemId: null,
              },
            })

            for (const item of entertainmentItems) {
              await db.floorPlanElement.updateMany({
                where: { linkedMenuItemId: item.id, deletedAt: null, status: 'in_use' },
                data: {
                  status: 'available',
                  currentOrderId: null,
                  sessionStartedAt: null,
                  sessionExpiresAt: null,
                },
              })
            }

            void dispatchFloorPlanUpdate(updatedOrder.locationId, { async: true }).catch(() => {})
            for (const item of entertainmentItems) {
              void dispatchEntertainmentStatusChanged(updatedOrder.locationId, {
                itemId: item.id,
                entertainmentStatus: 'available',
                currentOrderId: null,
                expiresAt: null,
              }, { async: true }).catch(() => {})
              void notifyNextWaitlistEntry(updatedOrder.locationId, item.id, item.name).catch(() => {})
            }
          }
        } catch (cleanupErr) {
          console.error('[Order Update] Failed to auto-stop entertainment sessions:', cleanupErr)
        }
      })()
    }

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
      isTaxExempt,
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
      isTaxExempt?: boolean
    }

    // Input validation for fields that bypass Zod
    if (tipTotal !== undefined && tipTotal !== null && Number(tipTotal) < 0) {
      return NextResponse.json({ error: 'Tip total cannot be negative' }, { status: 400 })
    }
    if (tabName !== undefined && tabName !== null && tabName.length > 50) {
      return NextResponse.json({ error: 'Tab name cannot exceed 50 characters' }, { status: 400 })
    }
    if (notes !== undefined && notes !== null && notes.length > 500) {
      return NextResponse.json({ error: 'Notes cannot exceed 500 characters' }, { status: 400 })
    }

    // Cellular ownership gating — block mutation of locally-owned orders
    const isCellularPatch = request.headers.get('x-cellular-authenticated') === '1'
    if (isCellularPatch) {
      const { validateCellularOrderAccess, CellularAuthError } = await import('@/lib/cellular-validation')
      try {
        await validateCellularOrderAccess(true, id, 'mutate', db)
      } catch (err) {
        if (err instanceof CellularAuthError) {
          return NextResponse.json({ error: err.message }, { status: err.status })
        }
        throw err
      }
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let patchLocationId = getRequestLocationId()
    if (!patchLocationId) {
      const patchLocationCheck = await db.order.findFirst({
        where: { id },
        select: { locationId: true },
      })
      if (!patchLocationCheck) {
        return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
      }
      patchLocationId = patchLocationCheck.locationId
    }

    const existing = await OrderRepository.getOrderByIdWithSelect(id, patchLocationId, {
        id: true,
        status: true,
        locationId: true,
        subtotal: true,
        taxTotal: true,
        discountTotal: true,
        tipTotal: true,
        isTaxExempt: true,
        inclusiveTaxRate: true,
        items: {
          where: { deletedAt: null, status: 'active' },
          select: {
            price: true,
            quantity: true,
            isTaxInclusive: true,
            status: true,
            commissionAmount: true,
            modifiers: {
              where: { deletedAt: null },
              select: { price: true },
            },
          },
        },
        location: { select: { settings: true } },
    })

    if (!existing) {
      return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
    }

    // Auth check — require POS access for order edits
    const requestingEmployeeId = request.headers.get('x-employee-id') || body.requestingEmployeeId || body.employeeId
    if (requestingEmployeeId) {
      const auth = await requirePermission(requestingEmployeeId, existing.locationId, PERMISSIONS.POS_ACCESS)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
      // Elevated checks for sensitive field changes
      if (tableId !== undefined) {
        const tAuth = await requirePermission(requestingEmployeeId, existing.locationId, PERMISSIONS.POS_CHANGE_TABLE)
        if (!tAuth.authorized) return NextResponse.json({ error: tAuth.error }, { status: tAuth.status })
      }
      if (employeeId !== undefined && employeeId !== requestingEmployeeId) {
        const sAuth = await requirePermission(requestingEmployeeId, existing.locationId, PERMISSIONS.POS_CHANGE_SERVER)
        if (!sAuth.authorized) return NextResponse.json({ error: sAuth.error }, { status: sAuth.status })
      }
      if (isTaxExempt !== undefined) {
        const txAuth = await requirePermission(requestingEmployeeId, existing.locationId, PERMISSIONS.MGR_TAX_EXEMPT)
        if (!txAuth.authorized) return NextResponse.json({ error: txAuth.error }, { status: txAuth.status })
      }
    }

    if (!isModifiable(existing.status)) {
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

    // Recalculate totals when tax exemption status changes
    let taxExemptTotals: { taxTotal: number; total: number; taxFromInclusive: number; taxFromExclusive: number } | undefined
    if (isTaxExempt !== undefined && isTaxExempt !== existing.isTaxExempt) {
      const orderTotals = calculateOrderTotals(
        existing.items.filter(i => i.status === 'active').map(i => ({
          price: Number(i.price),
          quantity: i.quantity,
          isTaxInclusive: i.isTaxInclusive ?? false,
          status: i.status,
          modifiers: (i.modifiers ?? []).map(m => ({ price: Number(m.price) })),
          commissionAmount: Number(i.commissionAmount ?? 0),
        })),
        existing.location.settings as { tax?: { defaultRate?: number } },
        Number(existing.discountTotal),
        Number(existing.tipTotal ?? 0),
        undefined,
        'card',
        isTaxExempt,
        Number(existing.inclusiveTaxRate) || undefined
      )
      taxExemptTotals = {
        taxTotal: orderTotals.taxTotal,
        total: orderTotals.total,
        taxFromInclusive: orderTotals.taxFromInclusive,
        taxFromExclusive: orderTotals.taxFromExclusive,
      }
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
    if (isTaxExempt !== undefined) {
      updateData.isTaxExempt = isTaxExempt
      if (taxExemptTotals) {
        updateData.taxTotal = taxExemptTotals.taxTotal
        updateData.taxFromInclusive = taxExemptTotals.taxFromInclusive
        updateData.taxFromExclusive = taxExemptTotals.taxFromExclusive
        updateData.total = taxExemptTotals.total
      }
    }
    if (status !== undefined) {
      // Status transition validation — single source of truth in domain module
      const transition = validateTransition(existing.status, status)
      if (!transition.valid) {
        return apiError.badRequest(transition.error!, ERROR_CODES.INVALID_ORDER_STATUS)
      }

      updateData.status = status
      if (status === 'cancelled' || status === 'closed') {
        updateData.closedAt = new Date()
      }
    }

    // Lightweight update — no items, no modifiers, no employee includes
    const updatedOrder = await OrderRepository.updateOrderAndSelect(
      id,
      existing.locationId,
      { ...updateData, version: { increment: 1 } },
      {
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
        isTaxExempt: true,
      },
    )

    if (!updatedOrder) {
      return apiError.notFound('Order not found after update', ERROR_CODES.ORDER_NOT_FOUND)
    }

    // Dispatch socket updates for cross-terminal sync
    if (tipTotal !== undefined || isTaxExempt !== undefined) {
      dispatchOrderTotalsUpdate(updatedOrder.locationId, updatedOrder.id, {
        subtotal: Number(updatedOrder.subtotal),
        taxTotal: Number(updatedOrder.taxTotal),
        tipTotal: Number(updatedOrder.tipTotal),
        discountTotal: Number(updatedOrder.discountTotal),
        total: Number(updatedOrder.total),
        commissionTotal: Number(updatedOrder.commissionTotal || 0),
      }, { async: true }).catch(console.error)
    }

    // Dispatch order:updated for metadata changes (tabName, guestCount, notes, tableId, etc.)
    // This notifies other terminals (especially Android) of the metadata change
    if (Object.keys(updateData).length > 0) {
      void dispatchOrderUpdated(updatedOrder.locationId, { orderId: updatedOrder.id }).catch(() => {})
    }

    // Auto-stop entertainment sessions when order is voided/cancelled/closed via PATCH
    // TODO: migrate to MenuItemRepository/FloorPlanElementRepository once those repos exist
    // (queries use currentOrderId filter + relation-filter menuItem.itemType, not supported by current repos)
    if (status !== undefined && ['voided', 'cancelled', 'closed'].includes(status)) {
      void (async () => {
        try {
          // TODO: migrate to MenuItemRepository/FloorPlanElementRepository once those repos exist
          const entertainmentItems = await db.menuItem.findMany({
            where: { currentOrderId: id, itemType: 'timed_rental' },
            select: { id: true, name: true },
          })

          if (entertainmentItems.length > 0) {
            await db.orderItem.updateMany({
              where: { orderId: id, menuItem: { itemType: 'timed_rental' }, blockTimeStartedAt: { not: null } },
              data: { blockTimeStartedAt: null },
            })

            await db.menuItem.updateMany({
              where: { currentOrderId: id, itemType: 'timed_rental' },
              data: {
                entertainmentStatus: 'available',
                currentOrderId: null,
                currentOrderItemId: null,
              },
            })

            for (const item of entertainmentItems) {
              await db.floorPlanElement.updateMany({
                where: { linkedMenuItemId: item.id, deletedAt: null, status: 'in_use' },
                data: {
                  status: 'available',
                  currentOrderId: null,
                  sessionStartedAt: null,
                  sessionExpiresAt: null,
                },
              })
            }

            void dispatchFloorPlanUpdate(updatedOrder.locationId, { async: true }).catch(() => {})
            for (const item of entertainmentItems) {
              void dispatchEntertainmentStatusChanged(updatedOrder.locationId, {
                itemId: item.id,
                entertainmentStatus: 'available',
                currentOrderId: null,
                expiresAt: null,
              }, { async: true }).catch(() => {})
              void notifyNextWaitlistEntry(updatedOrder.locationId, item.id, item.name).catch(() => {})
            }
          }
        } catch (cleanupErr) {
          console.error('[Order PATCH] Failed to auto-stop entertainment sessions:', cleanupErr)
        }
      })()
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
      isTaxExempt: updatedOrder.isTaxExempt,
    } })
  } catch (error) {
    console.error('Failed to patch order:', error)
    return apiError.internalError('Failed to update order', ERROR_CODES.INTERNAL_ERROR)
  }
})
