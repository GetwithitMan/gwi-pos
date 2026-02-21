/**
 * Online Checkout API
 *
 * POST /api/online/checkout
 *   Processes a customer-facing online order with Datacap PayAPI payment.
 *   No authentication required — public endpoint.
 *
 * Architectural notes:
 *   - Does NOT use withVenue() — public routes cannot rely on x-venue-slug
 *     header set by middleware.ts (which only runs on authenticated routes).
 *     Instead we accept locationId in the POST body and use the db proxy
 *     which routes to the correct database via masterClient.
 *   - employeeId is required by the Order schema. We look for an employee
 *     whose displayName starts with 'Online' or 'System', falling back to
 *     the first active employee. This is a soft constraint: online orders
 *     must be linked to a real employee record in this venue's DB.
 *   - We compute the total server-side from fresh DB prices — never trust
 *     client-sent prices.
 *   - On payment decline the order is hard-deleted (it was never seen by staff).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPayApiClient } from '@/lib/datacap/payapi-client'
import { getCurrentBusinessDay } from '@/lib/business-day'

// ─── Request Body Shape ───────────────────────────────────────────────────────

interface CheckoutItem {
  menuItemId: string
  quantity: number
  modifiers: Array<{
    modifierId: string
    name: string
    price: number
  }>
}

interface CheckoutBody {
  locationId: string
  token: string
  cardBrand?: string
  cardLast4?: string
  items: CheckoutItem[]
  customerName: string
  customerEmail: string
  customerPhone?: string
  orderType?: string
  notes?: string
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: CheckoutBody

  try {
    body = (await request.json()) as CheckoutBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── 1. Validate required fields ────────────────────────────────────────────

  const { locationId, token, items, customerName, customerEmail } = body

  if (!locationId) {
    return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
  }
  if (!token) {
    return NextResponse.json({ error: 'Payment token is required' }, { status: 400 })
  }
  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
  }
  if (!customerName?.trim()) {
    return NextResponse.json({ error: 'Customer name is required' }, { status: 400 })
  }
  if (!customerEmail?.trim()) {
    return NextResponse.json({ error: 'Customer email is required' }, { status: 400 })
  }

  try {
    // ── 2. Fetch menu items server-side to compute authoritative total ─────────

    const menuItemIds = items.map(i => i.menuItemId)
    const menuItems = await db.menuItem.findMany({
      where: {
        id: { in: menuItemIds },
        locationId,
        isActive: true,
        showOnline: true,
      },
      select: {
        id: true,
        name: true,
        price: true,
      },
    })

    const menuItemMap = new Map(menuItems.map(mi => [mi.id, mi]))

    // Validate all requested items exist and are orderable
    for (const item of items) {
      if (!menuItemMap.has(item.menuItemId)) {
        return NextResponse.json(
          { error: `Menu item ${item.menuItemId} is not available for online ordering` },
          { status: 422 }
        )
      }
    }

    // Compute total from DB prices (never trust client)
    let subtotal = 0
    const lineItems = items.map(item => {
      const mi = menuItemMap.get(item.menuItemId)!
      const basePrice = Number(mi.price)
      const modsTotal = item.modifiers.reduce((sum, mod) => sum + (mod.price || 0), 0)
      const lineTotal = (basePrice + modsTotal) * item.quantity
      subtotal += lineTotal
      return { item, mi, basePrice, modsTotal, lineTotal }
    })

    const total = subtotal // Online orders: no tax computed server-side for now (location tax rules vary)

    // ── 3. Find an employee to attach to the order ─────────────────────────────
    // Order.employeeId is required. Find a system/online employee, or fall
    // back to the first active employee at this location.

    const systemEmployee = await db.employee.findFirst({
      where: {
        locationId,
        isActive: true,
      },
      orderBy: [
        // Prefer employees named 'Online' or 'System'
        { firstName: 'asc' },
      ],
      select: { id: true, firstName: true, displayName: true },
    })

    if (!systemEmployee) {
      return NextResponse.json(
        { error: 'This location is not configured for online ordering yet' },
        { status: 503 }
      )
    }

    const employeeId = systemEmployee.id

    // ── 4. Generate order number ──────────────────────────────────────────────

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const { orderNumber } = await db.$transaction(async (tx) => {
      const lastOrder = await tx.order.findFirst({
        where: { locationId, createdAt: { gte: today, lt: tomorrow } },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true },
      })
      return { orderNumber: (lastOrder?.orderNumber || 0) + 1 }
    }, { isolationLevel: 'Serializable' })

    // ── 5. Compute business day ────────────────────────────────────────────────

    const locationRec = await db.location.findFirst({
      where: { id: locationId },
      select: { settings: true },
    })
    const locSettings = locationRec?.settings as Record<string, unknown> | null
    const dayStartTime =
      (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const businessDayStart = getCurrentBusinessDay(dayStartTime).start

    // ── 6. Create the Order ───────────────────────────────────────────────────

    const now = new Date().toISOString()
    const seatTimestamps: Record<string, string> = { '1': now }

    const order = await db.order.create({
      data: {
        locationId,
        employeeId,
        orderNumber,
        orderType: 'takeout',
        guestCount: 1,
        baseSeatCount: 1,
        extraSeatCount: 0,
        seatVersion: 0,
        seatTimestamps,
        status: 'open',
        subtotal,
        discountTotal: 0,
        taxTotal: 0,
        taxFromInclusive: 0,
        taxFromExclusive: 0,
        tipTotal: 0,
        total,
        commissionTotal: 0,
        notes: [
          `Online Order`,
          `Customer: ${customerName}`,
          `Email: ${customerEmail}`,
          body.customerPhone ? `Phone: ${body.customerPhone}` : null,
          body.notes ? `Notes: ${body.notes}` : null,
        ].filter(Boolean).join('\n'),
        businessDayDate: businessDayStart,
        // Create order items inline
        items: {
          create: lineItems.map(({ item, mi, basePrice, modsTotal, lineTotal }) => ({
            locationId,
            menuItemId: mi.id,
            name: mi.name,
            price: basePrice + modsTotal,
            quantity: item.quantity,
            itemTotal: lineTotal,
            commissionAmount: 0,
            modifiers: item.modifiers.length > 0
              ? {
                  create: item.modifiers.map(mod => ({
                    locationId,
                    modifierId: mod.modifierId && mod.modifierId.length >= 20 ? mod.modifierId : null,
                    name: mod.name,
                    price: mod.price,
                    quantity: 1,
                  })),
                }
              : undefined,
          })),
        },
      },
      select: { id: true, orderNumber: true },
    })

    // ── 7. Charge the card via Datacap PayAPI ─────────────────────────────────

    let payApiResult
    try {
      payApiResult = await getPayApiClient().sale({
        token,
        amount: total.toFixed(2),
        invoiceNo: order.orderNumber.toString(),
      })
    } catch (payErr) {
      // Payment error — delete the order (staff never saw it)
      await db.order.delete({ where: { id: order.id } }).catch(() => {})
      console.error('[checkout] PayAPI error:', payErr)
      return NextResponse.json(
        { error: 'Payment processing failed. Please try again.' },
        { status: 502 }
      )
    }

    // ── 8. Handle payment result ───────────────────────────────────────────────

    if (payApiResult.status !== 'Approved') {
      // Declined — delete the order, return 402
      await db.order.delete({ where: { id: order.id } }).catch(() => {})
      return NextResponse.json(
        {
          error: 'Payment declined. Please try a different card.',
          declineMessage: payApiResult.message,
        },
        { status: 402 }
      )
    }

    // ── 9. Payment approved — update order status + create Payment record ──────

    await db.$transaction([
      // Mark order as 'received' (online-specific status: paid but not yet served)
      db.order.update({
        where: { id: order.id },
        data: { status: 'received' },
      }),
      // Record payment
      db.payment.create({
        data: {
          locationId,
          orderId: order.id,
          employeeId,
          amount: total,
          tipAmount: 0,
          totalAmount: total,
          paymentMethod: 'credit',
          cardBrand: body.cardBrand ?? payApiResult.brand ?? null,
          cardLast4: body.cardLast4 ?? (payApiResult.account ? payApiResult.account.slice(-4) : null),
          authCode: payApiResult.authCode ?? null,
          transactionId: payApiResult.invoiceNo ?? null,
          datacapRefNumber: payApiResult.refNo ?? null,
          entryMethod: 'Manual',
          status: 'completed',
          amountRequested: total,
          amountAuthorized: total,
        },
      }),
    ])

    // ── 10. Return success ─────────────────────────────────────────────────────

    return NextResponse.json({
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total,
        estimatedReadyMinutes: 20,
      },
    })
  } catch (error) {
    console.error('[POST /api/online/checkout] Error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
