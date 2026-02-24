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
 *   - employeeId is required by the Order schema. We find or create a
 *     dedicated "Online Order" employee — never fall back to random staff.
 *   - We compute the total server-side from fresh DB prices — never trust
 *     client-sent prices (items or modifiers).
 *   - Modifier ownership is validated: each modifier must belong to a
 *     ModifierGroup owned by the ordered MenuItem.
 *   - On payment decline the order is soft-deleted (not hard-deleted).
 *   - Rate limited per IP+location to prevent abuse.
 *   - Online ordering must be enabled in location settings.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, getDbForVenue } from '@/lib/db'
import { getPayApiClient } from '@/lib/datacap/payapi-client'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { getLocationTaxRate, calculateTax } from '@/lib/order-calculations'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'

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
  slug?: string
  token: string
  cardBrand?: string
  cardLast4?: string
  items: CheckoutItem[]
  customerName: string
  customerEmail: string
  customerPhone?: string
  orderType?: string
  notes?: string
  tip?: number
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Extract client IP for rate limiting
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'

  let body: CheckoutBody

  try {
    body = (await request.json()) as CheckoutBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── 1. Validate required fields ────────────────────────────────────────────

  const { locationId, slug, token, items, customerName, customerEmail } = body

  if (!locationId) {
    return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
  }

  // ── 1a. Rate limit (BUG #388) ─────────────────────────────────────────────

  const rateCheck = checkOnlineRateLimit(ip, locationId, 'checkout')
  if (!rateCheck.allowed) {
    const resp = NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429 }
    )
    resp.headers.set('Retry-After', String(rateCheck.retryAfterSeconds ?? 60))
    return resp
  }

  // Route to venue DB when slug is provided (cloud/Vercel multi-tenant).
  // Falls back to db proxy (NUC local mode).
  const venueDb = slug ? getDbForVenue(slug) : db

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

  // ── 1b. Validate item quantities (BUG #391) ──────────────────────────────

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return NextResponse.json(
        { error: 'Each item quantity must be a positive integer' },
        { status: 400 }
      )
    }
  }

  try {
    // ── 1c. Check online ordering is enabled (BUG #394) ─────────────────────

    const locationRec = await venueDb.location.findFirst({
      where: { id: locationId },
      select: { settings: true },
    })
    const locSettings = locationRec?.settings as Record<string, unknown> | null
    const onlineSettings = locSettings?.onlineOrdering as Record<string, unknown> | null

    if (!onlineSettings?.enabled) {
      return NextResponse.json(
        { error: 'Online ordering is not currently available' },
        { status: 503 }
      )
    }

    // ── 2. Fetch menu items server-side (BUG #386: deletedAt filter) ─────────

    const menuItemIds = items.map(i => i.menuItemId)
    const menuItems = await venueDb.menuItem.findMany({
      where: {
        id: { in: menuItemIds },
        locationId,
        isActive: true,
        showOnline: true,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        price: true,
        onlinePrice: true,
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

    // ── 2b. Fetch and validate modifiers from DB (BUG #383, #390) ────────────

    const allModifierIds = items
      .flatMap(item => item.modifiers.map(m => m.modifierId))
      .filter(Boolean)

    const modifierMap = new Map<
      string,
      { id: string; name: string; price: unknown; modifierGroup: { menuItemId: string | null } }
    >()

    if (allModifierIds.length > 0) {
      const dbModifiers = await venueDb.modifier.findMany({
        where: {
          id: { in: allModifierIds },
          locationId,
          isActive: true,
          showOnline: true,
          deletedAt: null,
          modifierGroup: {
            deletedAt: null,
            showOnline: true,
          },
        },
        select: {
          id: true,
          name: true,
          price: true,
          modifierGroup: {
            select: { menuItemId: true },
          },
        },
      })
      for (const m of dbModifiers) {
        modifierMap.set(m.id, m)
      }
    }

    // Validate each modifier exists in DB and belongs to the correct menu item
    for (const item of items) {
      for (const mod of item.modifiers) {
        if (!mod.modifierId) {
          return NextResponse.json(
            { error: 'Each modifier must include a valid modifierId' },
            { status: 400 }
          )
        }
        const dbMod = modifierMap.get(mod.modifierId)
        if (!dbMod) {
          return NextResponse.json(
            { error: `Modifier ${mod.modifierId} is not available for online ordering` },
            { status: 422 }
          )
        }
        // BUG #390: Validate modifier belongs to this menu item's modifier group
        if (dbMod.modifierGroup.menuItemId !== item.menuItemId) {
          return NextResponse.json(
            { error: `Modifier ${mod.modifierId} does not belong to the selected item` },
            { status: 422 }
          )
        }
      }
    }

    // ── 2c. Compute total from DB prices (never trust client) ────────────────

    let subtotal = 0
    const lineItems = items.map(item => {
      const mi = menuItemMap.get(item.menuItemId)!
      // BUG #385: Use onlinePrice when set, otherwise fall back to base price
      const basePrice = mi.onlinePrice != null ? Number(mi.onlinePrice) : Number(mi.price)
      // BUG #383: Use DB modifier prices, not client-supplied
      const modsTotal = item.modifiers.reduce((sum, mod) => {
        const dbMod = modifierMap.get(mod.modifierId)
        return sum + (dbMod ? Number(dbMod.price) : 0)
      }, 0)
      const lineTotal = (basePrice + modsTotal) * item.quantity
      subtotal += lineTotal
      return { item, mi, basePrice, modsTotal, lineTotal }
    })

    const tip = typeof body.tip === 'number' && body.tip >= 0 ? Math.round(body.tip * 100) / 100 : 0

    // ── 2d. Fetch location settings for tax rate ─────────────────────────────

    const taxRate = getLocationTaxRate(locSettings as { tax?: { defaultRate?: number } })
    const taxTotal = calculateTax(subtotal, taxRate)
    const taxFromExclusive = taxTotal // Online orders use exclusive tax (added on top)
    const total = subtotal + taxTotal
    const chargeAmount = total + tip // Total charged to card includes tip

    // ── 3. Find or create a dedicated online employee (BUG #398) ─────────────

    let systemEmployee = await venueDb.employee.findFirst({
      where: {
        locationId,
        isActive: true,
        deletedAt: null,
        OR: [
          { displayName: 'Online Order' },
          { firstName: 'Online' },
          { firstName: 'System' },
        ],
      },
      select: { id: true },
    })

    if (!systemEmployee) {
      // Create a dedicated system employee for online orders
      const role = await venueDb.role.findFirst({
        where: { locationId },
        select: { id: true },
      })
      if (!role) {
        return NextResponse.json(
          { error: 'This location is not configured for online ordering yet' },
          { status: 503 }
        )
      }
      systemEmployee = await venueDb.employee.create({
        data: {
          locationId,
          roleId: role.id,
          firstName: 'Online',
          lastName: 'Order',
          displayName: 'Online Order',
          pin: 'SYSTEM-NO-LOGIN',
          isActive: true,
        },
        select: { id: true },
      })
    }

    const employeeId = systemEmployee.id

    // ── 4. Resolve order type (BUG #397) ────────────────────────────────────

    let orderType = 'takeout'
    let orderTypeId: string | null = null

    const allowedOrderTypes = (onlineSettings?.orderTypes as string[] | undefined) ?? ['takeout']
    const requestedType = body.orderType && allowedOrderTypes.includes(body.orderType)
      ? body.orderType
      : 'takeout'

    const dbOrderType = await venueDb.orderType.findFirst({
      where: { locationId, slug: requestedType, isActive: true },
      select: { id: true, slug: true },
    })
    if (dbOrderType) {
      orderType = dbOrderType.slug
      orderTypeId = dbOrderType.id
    }

    // ── 5. Generate order number ──────────────────────────────────────────────

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const { orderNumber } = await venueDb.$transaction(async (tx) => {
      const lastOrder = await tx.order.findFirst({
        where: { locationId, createdAt: { gte: today, lt: tomorrow } },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true },
      })
      return { orderNumber: (lastOrder?.orderNumber || 0) + 1 }
    }, { isolationLevel: 'Serializable' })

    // ── 6. Compute business day ────────────────────────────────────────────────

    const dayStartTime =
      (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const businessDayStart = getCurrentBusinessDay(dayStartTime).start

    // ── 7. Create the Order ───────────────────────────────────────────────────

    const now = new Date().toISOString()
    const seatTimestamps: Record<string, string> = { '1': now }

    const order = await venueDb.order.create({
      data: {
        locationId,
        employeeId,
        orderNumber,
        orderType,
        orderTypeId,
        guestCount: 1,
        baseSeatCount: 1,
        extraSeatCount: 0,
        seatVersion: 0,
        seatTimestamps,
        status: 'open',
        subtotal,
        discountTotal: 0,
        taxTotal,
        taxFromInclusive: 0,
        taxFromExclusive,
        tipTotal: tip,
        total: chargeAmount,
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
                  create: item.modifiers.map(mod => {
                    const dbMod = modifierMap.get(mod.modifierId)
                    return {
                      locationId,
                      modifierId: mod.modifierId.length >= 20 ? mod.modifierId : null,
                      name: dbMod?.name ?? mod.name,
                      price: dbMod ? Number(dbMod.price) : 0,
                      quantity: 1,
                    }
                  }),
                }
              : undefined,
          })),
        },
      },
      select: { id: true, orderNumber: true },
    })

    // ── 8. Charge the card via Datacap PayAPI ─────────────────────────────────

    let payApiResult
    try {
      payApiResult = await getPayApiClient().sale({
        token,
        amount: chargeAmount.toFixed(2),
        invoiceNo: order.orderNumber.toString(),
      })
    } catch (payErr) {
      // Payment error — soft-delete the order (BUG #389: never hard-delete)
      await venueDb.order.update({
        where: { id: order.id },
        data: { status: 'cancelled', deletedAt: new Date() },
      }).catch(() => {})
      console.error('[checkout] PayAPI error:', payErr)
      return NextResponse.json(
        { error: 'Payment processing failed. Please try again.' },
        { status: 502 }
      )
    }

    // ── 9. Handle payment result ───────────────────────────────────────────────

    if (payApiResult.status !== 'Approved') {
      // Declined — soft-delete the order (BUG #389), return 402
      await venueDb.order.update({
        where: { id: order.id },
        data: { status: 'cancelled', deletedAt: new Date() },
      }).catch(() => {})
      return NextResponse.json(
        {
          error: 'Payment declined. Please try a different card.',
          declineMessage: payApiResult.message,
        },
        { status: 402 }
      )
    }

    // ── 10. Payment approved — update order status + create Payment record ────

    await venueDb.$transaction([
      // Mark order as 'received' (online-specific status: paid but not yet served)
      venueDb.order.update({
        where: { id: order.id },
        data: { status: 'received' },
      }),
      // Record payment
      venueDb.payment.create({
        data: {
          locationId,
          orderId: order.id,
          employeeId,
          amount: total,
          tipAmount: tip,
          totalAmount: chargeAmount,
          paymentMethod: 'credit',
          cardBrand: body.cardBrand ?? payApiResult.brand ?? null,
          cardLast4: body.cardLast4 ?? (payApiResult.account ? payApiResult.account.slice(-4) : null),
          authCode: payApiResult.authCode ?? null,
          transactionId: payApiResult.invoiceNo ?? null,
          datacapRefNumber: payApiResult.refNo ?? null,
          entryMethod: 'Manual',
          status: 'completed',
          amountRequested: chargeAmount,
          amountAuthorized: chargeAmount,
        },
      }),
    ])

    // ── 11. Return success ─────────────────────────────────────────────────────

    const prepTimeMinutes =
      (onlineSettings?.prepTime as number | undefined) ?? 20

    return NextResponse.json({
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        subtotal,
        tax: taxTotal,
        tip,
        total: chargeAmount,
        prepTime: prepTimeMinutes,
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
