/**
 * Online Checkout API
 *
 * POST /api/online/checkout
 *   Processes a customer-facing online order with Datacap PayAPI payment.
 *   No authentication required — public endpoint.
 *
 * Architectural notes:
 *   - Does NOT use withVenue() — public routes cannot rely on x-venue-slug
 *     header set by proxy.ts (which only runs on authenticated routes).
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

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db, getDbForVenue } from '@/lib/db'
import { getPayApiClient } from '@/lib/datacap/payapi-client'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { getLocationTaxRate, calculateSplitTax, isItemTaxInclusive, type TaxInclusiveSettings } from '@/lib/order-calculations'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { upsertOnlineCustomer, accrueOnlineLoyaltyPoints } from '@/lib/customer-upsert'
import { generateOrderViewToken } from '@/app/api/public/order-status/[id]/route'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'

// ─── Zod Validation Schema ────────────────────────────────────────────────────

const CheckoutModifierSchema = z.object({
  modifierId: z.string().min(1),
  name: z.string().max(500).optional(),
  price: z.number().optional(),
  quantity: z.number().int().min(1).max(10).optional(),
})

const CheckoutItemSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  modifiers: z.array(CheckoutModifierSchema).default([]),
})

const CheckoutBodySchema = z.object({
  locationId: z.string().optional(), // backward compat: NUC direct path
  slug: z.string().min(1).optional(),
  token: z.string().optional(),
  cardBrand: z.string().max(50).optional(),
  cardLast4: z.string().max(4).optional(),
  items: z.array(CheckoutItemSchema).min(1).max(100),
  customerName: z.string().min(1).max(500),
  customerEmail: z.string().email().max(500),
  customerPhone: z.string().max(30).optional(),
  orderType: z.string().max(50).optional(),
  specialRequests: z.string().max(2000).optional(),
  tipAmount: z.number().min(0).max(9999).optional(),
  idempotencyKey: z.string().max(200).optional(),
  couponCode: z.string().max(100).optional(),
  giftCardNumber: z.string().max(100).optional(),
  giftCardPin: z.string().max(20).optional(),
  tableContext: z.object({
    table: z.string().optional(),
  }).optional(),
  // Delivery fields (optional — required when orderType === 'delivery')
  deliveryAddress: z.string().max(500).optional(),
  deliveryCity: z.string().max(100).optional(),
  deliveryState: z.string().max(2).optional(),
  deliveryZip: z.string().max(10).optional(),
  deliveryInstructions: z.string().max(500).optional(),
  // Deprecated fields (backward compat)
  notes: z.string().max(2000).optional(),
  tip: z.number().min(0).max(9999).optional(),
  tableId: z.string().optional(),
})

type CheckoutBody = z.infer<typeof CheckoutBodySchema>

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Extract client IP for rate limiting
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'

  let body: CheckoutBody

  try {
    const raw = await request.json()
    const parsed = CheckoutBodySchema.safeParse(raw)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid request body', details: parsed.error.issues },
        { status: 400 }
      )
    }
    body = parsed.data
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── 1. Resolve locationId from slug or body ────────────────────────────────

  const { slug, token, items, customerName, customerEmail } = body

  // Resolve locationId: prefer body.locationId (NUC direct), otherwise resolve from slug
  let locationId = body.locationId ?? ''

  // Route to venue DB when slug is provided (cloud/Vercel multi-tenant).
  // Falls back to db proxy (NUC local mode).
  const venueDb = slug ? await getDbForVenue(slug) : db

  if (!locationId && slug) {
    const location = await venueDb.location.findFirst({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    })
    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }
    locationId = location.id
  }

  if (!locationId) {
    return NextResponse.json({ error: 'slug or locationId is required' }, { status: 400 })
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

  // Token required unless a gift card number is provided (may cover full amount)
  if (!token && !body.giftCardNumber) {
    return NextResponse.json({ error: 'Payment token is required' }, { status: 400 })
  }

  // ── 1b. Resolve field name aliases (backward compat) ──────────────────────

  const tipAmount = body.tipAmount ?? body.tip
  const specialRequests = body.specialRequests ?? body.notes
  const tableId = body.tableContext?.table ?? body.tableId

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

    // ── 1d. Idempotency check ─────────────────────────────────────────────────

    if (body.idempotencyKey) {
      const existingOrder = await venueDb.order.findFirst({
        where: {
          locationId,
          metadata: { path: ['idempotencyKey'], equals: body.idempotencyKey },
          deletedAt: null,
        },
        select: { id: true, orderNumber: true, subtotal: true, taxTotal: true, tipTotal: true, total: true },
      })

      if (existingOrder) {
        const prepTimeMinutes = (onlineSettings?.prepTime as number | undefined) ?? 20
        return NextResponse.json({
          data: {
            orderId: existingOrder.id,
            orderNumber: existingOrder.orderNumber,
            subtotal: Number(existingOrder.subtotal),
            tax: Number(existingOrder.taxTotal),
            tip: Number(existingOrder.tipTotal),
            total: Number(existingOrder.total),
            prepTime: prepTimeMinutes,
            statusToken: generateOrderViewToken(existingOrder.id),
            duplicate: true,
          },
        })
      }
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
        category: { select: { categoryType: true } },
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
        // Fix #11: Allow universal modifier groups (menuItemId === null) for any item
        if (dbMod.modifierGroup.menuItemId !== null && dbMod.modifierGroup.menuItemId !== item.menuItemId) {
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
      // Fix #15: Respect client-sent modifier quantity (validated: 1–10)
      const modsTotal = item.modifiers.reduce((sum, mod) => {
        const dbMod = modifierMap.get(mod.modifierId)
        const modQty = mod.quantity ?? 1
        return sum + (dbMod ? Number(dbMod.price) * modQty : 0)
      }, 0)
      const lineTotal = (basePrice + modsTotal) * item.quantity
      subtotal += lineTotal
      return { item, mi, basePrice, modsTotal, lineTotal }
    })

    const tip = typeof tipAmount === 'number' && tipAmount >= 0 ? Math.round(tipAmount * 100) / 100 : 0

    // ── 2c½. Coupon validation (server-side re-validation) ──────────────────

    let couponDiscount = 0
    let couponId: string | null = null
    let couponDiscountType: string | null = null
    let couponUsageLimit: number | null = null

    if (body.couponCode) {
      const coupon = await venueDb.coupon.findFirst({
        where: {
          locationId,
          code: { equals: body.couponCode, mode: 'insensitive' as any },
          deletedAt: null,
        },
        select: {
          id: true, discountType: true, discountValue: true,
          minimumOrder: true, maximumDiscount: true,
          usageLimit: true, usageCount: true,
          perCustomerLimit: true,
          validFrom: true, validUntil: true, isActive: true,
        },
      })

      if (coupon && coupon.isActive) {
        const now = new Date()
        const withinDates = (!coupon.validFrom || now >= coupon.validFrom)
          && (!coupon.validUntil || now <= coupon.validUntil)
        const withinUsage = coupon.usageLimit == null || coupon.usageCount < coupon.usageLimit

        if (withinDates && withinUsage) {
          // Fix #14: Per-customer coupon limit check
          let perCustomerBlocked = false
          if (coupon.perCustomerLimit != null) {
            const customerIdentifier = customerEmail.toLowerCase().trim()
            const priorRedemptions = await venueDb.couponRedemption.count({
              where: {
                couponId: coupon.id,
                OR: [
                  { customer: { email: customerIdentifier } },
                  ...(body.customerPhone ? [{ customer: { phone: body.customerPhone } }] : []),
                ],
              },
            })
            if (priorRedemptions >= coupon.perCustomerLimit) {
              perCustomerBlocked = true
            }
          }
          const minMet = coupon.minimumOrder == null || subtotal >= Number(coupon.minimumOrder)
          if (minMet && !perCustomerBlocked) {
            couponId = coupon.id
            couponDiscountType = coupon.discountType
            couponUsageLimit = coupon.usageLimit
            const discountValue = Number(coupon.discountValue)
            const maxCap = coupon.maximumDiscount != null ? Number(coupon.maximumDiscount) : null

            if (coupon.discountType === 'percent') {
              couponDiscount = subtotal * discountValue / 100
            } else if (coupon.discountType === 'fixed') {
              couponDiscount = Math.min(discountValue, subtotal)
            }
            // free_item handled differently — no dollar discount at checkout
            if (maxCap != null && couponDiscount > maxCap) couponDiscount = maxCap
            couponDiscount = Math.round(couponDiscount * 100) / 100
          }
        }
      }
      // If coupon invalid, we silently ignore — don't block checkout
    }

    // ── 2d. Fetch location settings for tax rate ─────────────────────────────

    const onlineLocSettings = locSettings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number; taxInclusiveLiquor?: boolean; taxInclusiveFood?: boolean } } | null
    const taxRate = getLocationTaxRate(onlineLocSettings)
    const taxIncSettings: TaxInclusiveSettings = {
      taxInclusiveLiquor: onlineLocSettings?.tax?.taxInclusiveLiquor ?? false,
      taxInclusiveFood: onlineLocSettings?.tax?.taxInclusiveFood ?? false,
    }
    // Fix #9: Apply coupon discount BEFORE tax calculation
    const discountedSubtotal = subtotal - couponDiscount

    // Split items by tax-inclusive status based on category
    // Proportionally distribute coupon discount across inclusive/exclusive
    let rawInclusiveSubtotal = 0
    let rawExclusiveSubtotal = 0
    for (const { mi, lineTotal } of lineItems) {
      const itemInclusive = isItemTaxInclusive(mi.category?.categoryType, taxIncSettings)
      if (itemInclusive) {
        rawInclusiveSubtotal += lineTotal
      } else {
        rawExclusiveSubtotal += lineTotal
      }
    }
    // Distribute coupon discount proportionally
    const discountRatio = subtotal > 0 ? couponDiscount / subtotal : 0
    const inclusiveSubtotal = rawInclusiveSubtotal * (1 - discountRatio)
    const exclusiveSubtotal = rawExclusiveSubtotal * (1 - discountRatio)

    const inclusiveTaxRate = onlineLocSettings?.tax?.inclusiveTaxRate != null
      ? onlineLocSettings.tax.inclusiveTaxRate / 100 : undefined
    const { taxFromInclusive, taxFromExclusive, totalTax: taxTotal } = calculateSplitTax(
      inclusiveSubtotal, exclusiveSubtotal, taxRate, inclusiveTaxRate
    )

    // Fix #4: Add surcharge calculation
    let surchargeAmount = 0
    const surchargeType = onlineSettings?.surchargeType as string | null | undefined
    const surchargeValue = Number(onlineSettings?.surchargeAmount ?? 0)
    const surchargeName = (onlineSettings?.surchargeName as string | undefined) ?? 'Online Order Fee'

    if (surchargeType === 'flat' && surchargeValue > 0) {
      surchargeAmount = surchargeValue
    } else if (surchargeType === 'percent' && surchargeValue > 0) {
      surchargeAmount = Math.round(discountedSubtotal * (surchargeValue / 100) * 100) / 100
    }

    // ── 2d½. Delivery validation + zone lookup + fee ───────────────────────────

    let deliveryFee = 0
    let matchedZone: { id: string; deliveryFee: number; minimumOrder: number; estimatedMinutes: number | null } | null = null
    let deliveryTrackingToken: string | undefined

    if (body.orderType === 'delivery') {
      // Require address + zip for delivery
      if (!body.deliveryAddress?.trim()) {
        return NextResponse.json({ error: 'Delivery address is required' }, { status: 400 })
      }
      if (!body.deliveryZip?.trim()) {
        return NextResponse.json({ error: 'Delivery zip code is required' }, { status: 400 })
      }

      // Check delivery enabled in settings
      const fullSettings = mergeWithDefaults(locSettings as any)
      const deliveryConfig = fullSettings.delivery ?? DEFAULT_DELIVERY
      if (!deliveryConfig.enabled) {
        return NextResponse.json({ error: 'Delivery is not available' }, { status: 400 })
      }

      // Query active delivery zones (raw SQL — DeliveryZone not in Prisma)
      const zones: any[] = await venueDb.$queryRawUnsafe(
        `SELECT id, "deliveryFee", "minimumOrder", "estimatedMinutes", zipcodes, "zoneType"
         FROM "DeliveryZone"
         WHERE "locationId" = $1 AND "deletedAt" IS NULL AND "isActive" = true
         ORDER BY "sortOrder" ASC`,
        locationId
      )

      // Match zip against zones (same logic as quote engine)
      const customerZip = body.deliveryZip.trim()
      for (const zone of zones) {
        if (zone.zoneType === 'zipcode' && customerZip) {
          const zoneZips = Array.isArray(zone.zipcodes) ? zone.zipcodes : []
          if (zoneZips.includes(customerZip)) {
            matchedZone = {
              id: zone.id,
              deliveryFee: Number(zone.deliveryFee),
              minimumOrder: Number(zone.minimumOrder),
              estimatedMinutes: zone.estimatedMinutes,
            }
            break
          }
        }
      }

      if (!matchedZone) {
        return NextResponse.json({ error: 'Delivery not available for this address' }, { status: 400 })
      }

      // Minimum order check (against discounted subtotal)
      if (matchedZone.minimumOrder > 0 && discountedSubtotal < matchedZone.minimumOrder) {
        return NextResponse.json(
          { error: `Minimum order of $${matchedZone.minimumOrder.toFixed(2)} required for delivery` },
          { status: 400 }
        )
      }

      // Calculate delivery fee (with free delivery check)
      deliveryFee = matchedZone.deliveryFee
      if (deliveryConfig.freeDeliveryMinimum > 0 && discountedSubtotal >= deliveryConfig.freeDeliveryMinimum) {
        deliveryFee = 0
      }
    }

    const total = discountedSubtotal + taxFromExclusive + surchargeAmount + deliveryFee
    const totalPlusTip = total + tip // Total before gift card

    // ── 2e. Gift card validation ─────────────────────────────────────────────

    let giftCardApplied = 0
    let giftCardRecord: { id: string; cardNumber: string; currentBalance: number; pin: string | null } | null = null

    if (body.giftCardNumber) {
      const sanitizedGc = body.giftCardNumber.trim().toUpperCase()
      const gc = await venueDb.giftCard.findFirst({
        where: {
          cardNumber: sanitizedGc,
          locationId,
          status: 'active',
          deletedAt: null,
        },
        select: { id: true, cardNumber: true, currentBalance: true, pin: true, expiresAt: true, frozenAt: true },
      })

      if (gc && !gc.frozenAt && (!gc.expiresAt || new Date() <= gc.expiresAt)) {
        // PIN check — timing-safe comparison to prevent side-channel attacks
        const pinInput = body.giftCardPin || ''
        const pinOk = !gc.pin || (gc.pin.length === pinInput.length &&
          crypto.timingSafeEqual(Buffer.from(gc.pin), Buffer.from(pinInput)))
        if (pinOk) {
          const balance = Number(gc.currentBalance)
          giftCardApplied = Math.min(balance, totalPlusTip)
          giftCardApplied = Math.round(giftCardApplied * 100) / 100
          giftCardRecord = { id: gc.id, cardNumber: gc.cardNumber, currentBalance: balance, pin: gc.pin }
        }
      }
      // If gift card invalid, silently ignore — don't block checkout
    }

    const chargeAmount = totalPlusTip - giftCardApplied // Amount to charge via Datacap
    const skipDcPayment = chargeAmount <= 0 // Gift card covers everything

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

    // ── 5. Generate order number + 6. Compute business day ─────────────────────

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const dayStartTime =
      (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const businessDayStart = getCurrentBusinessDay(dayStartTime).start

    // ── 7. Create the Order (atomic: order number lock + create in one tx) ────

    const now = new Date().toISOString()
    const seatTimestamps: Record<string, string> = { '1': now }

    const order = await venueDb.$transaction(async (tx) => {
      // Lock latest order row to prevent duplicate order numbers
      const lastOrderRows = await tx.$queryRawUnsafe<{ orderNumber: number }[]>(
        `SELECT "orderNumber" FROM "Order" WHERE "locationId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3 ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE`,
        locationId, today, tomorrow
      )
      const orderNumber = ((lastOrderRows as any[])[0]?.orderNumber ?? 0) + 1

      // TX-KEEP: CREATE — online checkout order with nested items/modifiers inside order-number lock; no repo create method
      return tx.order.create({
        data: {
          locationId,
          employeeId,
          orderNumber,
          orderType,
          orderTypeId,
          source: 'online',
          guestCount: 1,
          baseSeatCount: 1,
          extraSeatCount: 0,
          seatVersion: 0,
          seatTimestamps,
          status: 'open',
          subtotal,
          discountTotal: couponDiscount,
          taxTotal,
          taxFromInclusive,
          taxFromExclusive,
          inclusiveTaxRate: inclusiveTaxRate || 0,
          tipTotal: tip,
          total: totalPlusTip,
          commissionTotal: 0,
          customFields: {
            ...(tableId ? { channel: 'qr', tableId, qrContextVersion: 1 } : { channel: 'web' }),
            ...(body.orderType === 'delivery' && matchedZone ? { deliveryZoneId: matchedZone.id, deliveryFee } : {}),
          },
          // Fix #12: No PII in notes — only "Online Order" + specialRequests
          notes: [
            'Online Order',
            specialRequests ? specialRequests : null,
          ].filter(Boolean).join('\n'),
          businessDayDate: businessDayStart,
          lastMutatedBy: 'cloud',
          ...(body.idempotencyKey ? { metadata: { idempotencyKey: body.idempotencyKey } } : {}),
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
              isTaxInclusive: isItemTaxInclusive(mi.category?.categoryType, taxIncSettings),
              modifiers: item.modifiers.length > 0
                ? {
                    create: item.modifiers.map(mod => {
                      const dbMod = modifierMap.get(mod.modifierId)
                      const modQty = mod.quantity ?? 1
                      return {
                        locationId,
                        modifierId: mod.modifierId.length >= 20 ? mod.modifierId : null,
                        name: dbMod?.name ?? mod.name ?? '',
                        price: dbMod ? Number(dbMod.price) : 0,
                        quantity: modQty,
                      }
                    }),
                  }
                : undefined,
            })),
          },
        },
        select: { id: true, orderNumber: true },
      })
    })

    // ── 8. Charge the card via Datacap PayAPI (skip if gift card covers all) ──

    let payApiResult: any = null

    if (!skipDcPayment) {
      // Datacap charge required (full or partial after gift card)
      if (!token) {
        // Gift card didn't cover everything and no card token provided
        await venueDb.order.update({
          where: { id: order.id },
          data: { status: 'cancelled', deletedAt: new Date(), lastMutatedBy: 'cloud' },
        }).catch(() => {})
        return NextResponse.json(
          { error: 'Payment token is required for the remaining balance' },
          { status: 400 }
        )
      }
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
          data: { status: 'cancelled', deletedAt: new Date(), lastMutatedBy: 'cloud' },
        }).catch(() => {})
        console.error('[checkout] PayAPI error:', payErr)
        return NextResponse.json(
          { error: 'Payment processing failed. Please try again.' },
          { status: 502 }
        )
      }

      // ── 9. Handle payment result ─────────────────────────────────────────────

      if (payApiResult.status !== 'Approved') {
        // Declined — soft-delete the order (BUG #389), return 402
        await venueDb.order.update({
          where: { id: order.id },
          data: { status: 'cancelled', deletedAt: new Date(), lastMutatedBy: 'cloud' },
        }).catch(() => {})
        return NextResponse.json(
          {
            error: 'Payment declined. Please try a different card.',
            declineMessage: payApiResult.message,
          },
          { status: 402 }
        )
      }
    }

    // ── 10. Payment approved — update order status + create Payment record(s) ──

    const paymentOps: any[] = [
      // TX-KEEP: COMPLEX — mark order received after payment; batch transaction
      venueDb.order.update({
        where: { id: order.id },
        data: { status: 'received', lastMutatedBy: 'cloud' },
      }),
    ]

    if (payApiResult) {
      // TX-KEEP: CREATE — card payment record after PayAPI approval
      paymentOps.push(
        venueDb.payment.create({
          data: {
            locationId,
            orderId: order.id,
            employeeId,
            amount: chargeAmount - tip, // base amount charged to card (excl tip)
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
            lastMutatedBy: 'cloud',
          },
        })
      )
    }

    if (giftCardApplied > 0 && giftCardRecord) {
      // Gift card payment record
      paymentOps.push(
        venueDb.payment.create({
          data: {
            locationId,
            orderId: order.id,
            employeeId,
            amount: giftCardApplied,
            tipAmount: 0,
            totalAmount: giftCardApplied,
            paymentMethod: 'gift_card',
            status: 'completed',
            amountRequested: giftCardApplied,
            amountAuthorized: giftCardApplied,
            lastMutatedBy: 'cloud',
          },
        })
      )
    }

    await venueDb.$transaction(paymentOps)

    // ── 10b. Customer upsert + link to order ─────────────────────────────────

    let customerId: string | null = null
    try {
      const customer = await upsertOnlineCustomer(venueDb, {
        phone: body.customerPhone,
        email: customerEmail,
        name: customerName,
        locationId,
      })
      customerId = customer.id

      // Link customer to order (idempotent — skip if already linked)
      await venueDb.order.update({
        where: { id: order.id },
        data: { customerId: customer.id },
      })

      // Accrue loyalty points (fire-and-forget)
      void accrueOnlineLoyaltyPoints(venueDb, customer.id, totalPlusTip).catch(console.error)
    } catch (custErr) {
      // Customer upsert failure should not block order success
      console.error('[checkout] Customer upsert error:', custErr)
    }

    // ── 10b½. Create DeliveryOrder (raw SQL — not in Prisma) ────────────────

    if (body.orderType === 'delivery' && matchedZone) {
      try {
        const deliveryOrderId = crypto.randomUUID()
        deliveryTrackingToken = crypto.randomUUID()
        await venueDb.$queryRawUnsafe(`
          INSERT INTO "DeliveryOrder" (
            id, "locationId", "orderId", status,
            "customerName", "customerPhone", "customerEmail",
            "deliveryAddress", "deliveryCity", "deliveryState", "deliveryZip",
            "deliveryInstructions", "deliveryFee", "zoneId",
            "estimatedMinutes", "trackingToken",
            "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
        `,
          deliveryOrderId, locationId, order.id, 'pending',
          body.customerName, body.customerPhone || '', body.customerEmail,
          body.deliveryAddress, body.deliveryCity || '', body.deliveryState || '', body.deliveryZip,
          body.deliveryInstructions || '', deliveryFee, matchedZone.id,
          matchedZone.estimatedMinutes || 30, deliveryTrackingToken,
          new Date()
        )
      } catch (deliveryErr) {
        // DeliveryOrder creation failure should NOT block the order
        console.error('[checkout] DeliveryOrder creation error:', deliveryErr)
        deliveryTrackingToken = undefined
      }
    }

    // ── 10c. Coupon redemption (idempotent) ──────────────────────────────────

    if (couponId && couponDiscount > 0) {
      try {
        // Idempotency: check if redemption already exists for this order
        const existingRedemption = await venueDb.couponRedemption.findFirst({
          where: { orderId: order.id, couponId },
        })
        if (!existingRedemption) {
          // Fix #8: Atomic coupon usage increment (prevents race condition)
          const updatedCoupon = await venueDb.coupon.updateMany({
            where: {
              id: couponId,
              OR: [
                { usageLimit: null },
                ...(couponUsageLimit != null ? [{ usageCount: { lt: couponUsageLimit } }] : []),
              ],
            },
            data: { usageCount: { increment: 1 } },
          })

          if (updatedCoupon.count > 0) {
            await venueDb.couponRedemption.create({
              data: {
                locationId,
                couponId,
                orderId: order.id,
                customerId: customerId ?? undefined,
                discountAmount: couponDiscount,
              },
            })
          }
          // If count === 0, coupon was exhausted concurrently — discount already applied to order,
          // but redemption not recorded. This is acceptable (customer got discount, usage cap intact).
        }
      } catch (couponErr) {
        // Coupon redemption failure should not block order success
        console.error('[checkout] Coupon redemption error:', couponErr)
      }
    }

    // ── 10d. Gift card deduction (atomic — Fix #7) ──────────────────────────

    if (giftCardApplied > 0 && giftCardRecord) {
      try {
        // Idempotency: check if transaction already exists for this order
        const existingGcTx = await venueDb.giftCardTransaction.findFirst({
          where: { orderId: order.id, giftCardId: giftCardRecord.id },
        })
        if (!existingGcTx) {
          await venueDb.$transaction(async (tx) => {
            // Atomic balance check + deduction (prevents race condition)
            const updatedGc = await tx.giftCard.updateMany({
              where: {
                id: giftCardRecord!.id,
                currentBalance: { gte: giftCardApplied },
              },
              data: {
                currentBalance: { decrement: giftCardApplied },
              },
            })
            if (updatedGc.count === 0) {
              throw new Error('Gift card balance insufficient (concurrent redemption)')
            }
            // Fetch updated balance for transaction log
            const gcAfter = await tx.giftCard.findUnique({
              where: { id: giftCardRecord!.id },
              select: { currentBalance: true },
            })
            const balanceAfter = gcAfter ? Number(gcAfter.currentBalance) : 0
            await tx.giftCardTransaction.create({
              data: {
                locationId,
                giftCardId: giftCardRecord!.id,
                type: 'redemption',
                amount: giftCardApplied,
                balanceBefore: giftCardRecord!.currentBalance,
                balanceAfter,
                orderId: order.id,
                notes: `Online order #${order.orderNumber}`,
              },
            })
            // Mark depleted if balance is zero
            if (balanceAfter <= 0) {
              await tx.giftCard.update({
                where: { id: giftCardRecord!.id },
                data: { status: 'depleted' },
              })
            }
          })
        }
      } catch (gcErr) {
        // Gift card deduction failure should not block order success
        console.error('[checkout] Gift card deduction error:', gcErr)
      }
    }

    // ── 10e. Create PendingDeduction (Fix #5) ────────────────────────────────

    try {
      const existingDeduction = await venueDb.pendingDeduction.findUnique({ where: { orderId: order.id } })
      if (!existingDeduction) {
        const firstPayment = await venueDb.payment.findFirst({
          where: { orderId: order.id },
          select: { id: true },
        })
        await venueDb.pendingDeduction.create({
          data: {
            locationId,
            orderId: order.id,
            paymentId: firstPayment?.id ?? null,
            deductionType: 'order_deduction',
            status: 'pending',
          },
        })
      }
    } catch (dedErr) {
      // PendingDeduction failure should not block order success
      console.error('[checkout] PendingDeduction error:', dedErr)
    }

    // ── 11. Emit events AFTER payment success (fire-and-forget) ────────────────

    void (async () => {
      const createdItems = await venueDb.orderItem.findMany({
        where: { orderId: order.id },
        select: { id: true, menuItemId: true, name: true, price: true, quantity: true },
      })
      const paymentRecord = await venueDb.payment.findFirst({
        where: { orderId: order.id },
        select: { id: true },
      })
      await emitOrderEvents(locationId, order.id, [
        {
          type: 'ORDER_CREATED',
          payload: {
            locationId,
            employeeId,
            orderType,
            guestCount: 1,
            orderNumber: order.orderNumber,
          },
        },
        ...createdItems.map(item => ({
          type: 'ITEM_ADDED' as const,
          payload: {
            lineItemId: item.id,
            menuItemId: item.menuItemId,
            name: item.name,
            priceCents: Math.round(Number(item.price) * 100),
            quantity: item.quantity,
            isHeld: false,
            soldByWeight: false,
          },
        })),
        // Fix #10: Emit ORDER_SENT between ITEM_ADDED and PAYMENT_APPLIED
        {
          type: 'ORDER_SENT' as const,
          payload: {
            sentItemIds: createdItems.map(item => item.id),
          },
        },
        {
          type: 'PAYMENT_APPLIED' as const,
          payload: {
            paymentId: paymentRecord?.id ?? crypto.randomUUID(),
            method: skipDcPayment ? 'gift_card' : 'card',
            amountCents: Math.round(total * 100),
            tipCents: Math.round(tip * 100),
            totalCents: Math.round(totalPlusTip * 100),
            cardBrand: payApiResult?.brand ?? body.cardBrand ?? null,
            cardLast4: payApiResult?.account ? payApiResult.account.slice(-4) : (body.cardLast4 ?? null),
            status: 'approved',
          },
        },
        {
          type: 'ORDER_CLOSED' as const,
          payload: { closedStatus: 'paid' },
        },
      ])
    })().catch(console.error)

    // ── 12. Return success ─────────────────────────────────────────────────────

    const prepTimeMinutes =
      (onlineSettings?.prepTime as number | undefined) ?? 20

    return NextResponse.json({
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        subtotal,
        tax: taxTotal,
        tip,
        surcharge: surchargeAmount > 0 ? surchargeAmount : undefined,
        surchargeName: surchargeAmount > 0 ? surchargeName : undefined,
        couponDiscount: couponDiscount > 0 ? couponDiscount : undefined,
        giftCardApplied: giftCardApplied > 0 ? giftCardApplied : undefined,
        total: totalPlusTip,
        charged: chargeAmount > 0 ? chargeAmount : undefined,
        deliveryFee: deliveryFee > 0 ? deliveryFee : undefined,
        deliveryTrackingToken: body.orderType === 'delivery' ? deliveryTrackingToken : undefined,
        prepTime: prepTimeMinutes,
        // Fix #3: Add status token for order tracking
        statusToken: generateOrderViewToken(order.id),
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
