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
import { getPayApiClient, isPayApiSuccess, type PayApiAchResponse } from '@/lib/datacap/payapi-client'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { getLocationTaxRate, calculateSplitTax, isItemTaxInclusive, type TaxInclusiveSettings } from '@/lib/order-calculations'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { upsertOnlineCustomer, accrueOnlineLoyaltyPoints } from '@/lib/customer-upsert'
import { generateOrderViewToken } from '@/app/api/public/order-status/[id]/route'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('online-checkout')

// ─── Geo Math Utilities (for radius/polygon delivery zone matching) ──────────

const EARTH_RADIUS_MILES = 3959

/** Haversine distance between two lat/lng points in miles. */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * EARTH_RADIUS_MILES * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Ray casting point-in-polygon test.
 * `polygon` is an array of [lng, lat] coordinate pairs (GeoJSON convention).
 */
function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1] // lat
    const yi = polygon[i][0] // lng
    const xj = polygon[j][1] // lat
    const yj = polygon[j][0] // lng
    const intersect =
      ((yi > lng) !== (yj > lng)) &&
      (lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Extract the outer ring of coordinates from a GeoJSON polygon.
 * Supports both Polygon and the first polygon of a MultiPolygon.
 */
function getPolygonRing(polygonJson: any): number[][] | null {
  if (!polygonJson || !polygonJson.type || !polygonJson.coordinates) return null
  if (polygonJson.type === 'Polygon') return polygonJson.coordinates[0] ?? null
  if (polygonJson.type === 'MultiPolygon') return polygonJson.coordinates[0]?.[0] ?? null
  return null
}

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

const AchDetailsSchema = z.object({
  routingNumber: z.string().length(9).regex(/^\d{9}$/, 'Routing number must be 9 digits'),
  accountNumber: z.string().min(4).max(24).regex(/^\d+$/, 'Account number must be numeric'),
  accountType: z.enum(['Checking', 'Savings']),
  accountHolderFirstName: z.string().min(1).max(50),
  accountHolderLastName: z.string().min(1).max(50),
})

const CheckoutBodySchema = z.object({
  locationId: z.string().optional(), // backward compat: NUC direct path
  slug: z.string().min(1).optional(),
  token: z.string().optional(),
  cardBrand: z.string().max(50).optional(),
  cardLast4: z.string().max(4).optional(),
  walletType: z.enum(['apple_pay', 'google_pay']).nullable().optional(), // wallet payment type
  // Payment method: 'card' (default) or 'ach'
  paymentMethod: z.enum(['card', 'ach']).optional(),
  // ACH bank account details (required when paymentMethod === 'ach')
  achDetails: AchDetailsSchema.optional(),
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
  deliveryLat: z.number().min(-90).max(90).optional(),
  deliveryLng: z.number().min(-180).max(180).optional(),
  // Deprecated fields (backward compat)
  notes: z.string().max(2000).optional(),
  tip: z.number().min(0).max(9999).optional(),
  tableId: z.string().optional(),
})

type CheckoutBody = z.infer<typeof CheckoutBodySchema>

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Extract client IP for rate limiting
  const ip = getClientIp(request)

  let body: CheckoutBody

  try {
    const raw = await request.json()
    const parsed = CheckoutBodySchema.safeParse(raw)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      return err(firstIssue?.message ?? 'Invalid request body', 400, parsed.error.issues)
    }
    body = parsed.data
  } catch {
    return err('Invalid JSON body')
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
      return notFound('Location not found')
    }
    locationId = location.id
  }

  if (!locationId) {
    return err('slug or locationId is required')
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

  // Determine payment method: 'ach' or 'card' (default)
  const isAchPayment = body.paymentMethod === 'ach'

  // Validate required fields based on payment method
  if (isAchPayment) {
    if (!body.achDetails) {
      return err('Bank account details are required for ACH payment')
    }
  } else {
    // Card payment: token required unless a gift card covers full amount
    if (!token && !body.giftCardNumber) {
      return err('Payment token is required')
    }
  }

  // ── 1b. Resolve field name aliases (backward compat) ──────────────────────

  const tipAmount = body.tipAmount ?? body.tip
  const specialRequests = body.specialRequests ?? body.notes
  const tableId = body.tableContext?.table ?? body.tableId

  try {
    // ── 1c. Check online ordering is enabled (BUG #394) ─────────────────────

    const locationRec = await venueDb.location.findFirst({
      where: { id: locationId },
      select: { settings: true, timezone: true },
    })
    const locSettings = locationRec?.settings as Record<string, unknown> | null
    const onlineSettings = locSettings?.onlineOrdering as Record<string, unknown> | null

    if (!onlineSettings?.enabled) {
      return err('Online ordering is not currently available', 503)
    }

    // ── 1c½. Check online ordering hours ──────────────────────────────────────
    const onlineHours = onlineSettings?.hours as
      | { day: number; open: string; close: string; closed: boolean }[]
      | undefined

    if (Array.isArray(onlineHours) && onlineHours.length > 0) {
      // Use venue timezone if available, otherwise UTC
      const venueTimezone = (locSettings?.timezone as string | undefined)
        || (await venueDb.location.findFirst({
            where: { id: locationId },
            select: { timezone: true },
          }))?.timezone
        || 'UTC'

      const nowInVenue = new Date(
        new Date().toLocaleString('en-US', { timeZone: venueTimezone })
      )
      const currentDay = nowInVenue.getDay() // 0=Sun .. 6=Sat
      const currentTime =
        String(nowInVenue.getHours()).padStart(2, '0') + ':' +
        String(nowInVenue.getMinutes()).padStart(2, '0')

      const todaySchedule = onlineHours.find(h => h.day === currentDay)

      if (todaySchedule?.closed) {
        return err('Online ordering is closed today', 503)
      }

      if (todaySchedule && todaySchedule.open && todaySchedule.close) {
        if (currentTime < todaySchedule.open || currentTime > todaySchedule.close) {
          return err(`Online ordering is currently outside operating hours (open ${todaySchedule.open} - ${todaySchedule.close})`, 503)
        }
      }
      // If no schedule entry for today or no open/close times: treat as always open
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
        return ok({
            orderId: existingOrder.id,
            orderNumber: existingOrder.orderNumber,
            subtotal: Number(existingOrder.subtotal),
            tax: Number(existingOrder.taxTotal),
            tip: Number(existingOrder.tipTotal),
            total: Number(existingOrder.total),
            prepTime: prepTimeMinutes,
            statusToken: generateOrderViewToken(existingOrder.id),
            duplicate: true,
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
        isAvailable: true,
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
        return err(`Menu item ${item.menuItemId} is not available for online ordering`, 422)
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
          return err('Each modifier must include a valid modifierId')
        }
        const dbMod = modifierMap.get(mod.modifierId)
        if (!dbMod) {
          return err(`Modifier ${mod.modifierId} is not available for online ordering`, 422)
        }
        // BUG #390: Validate modifier belongs to this menu item's modifier group
        // Fix #11: Allow universal modifier groups (menuItemId === null) for any item
        if (dbMod.modifierGroup.menuItemId !== null && dbMod.modifierGroup.menuItemId !== item.menuItemId) {
          return err(`Modifier ${mod.modifierId} does not belong to the selected item`, 422)
        }
      }
    }

    // ── 2b½. Server-side required modifier group validation ─────────────────
    // Validate that all required modifier groups are satisfied for each item.
    // Uses venueDb (not a transaction) because this runs before order creation.
    {
      const uniqueCheckoutMenuItemIds = [...new Set(items.map(i => i.menuItemId))]
      const requiredGroups = await venueDb.modifierGroup.findMany({
        where: {
          menuItemId: { in: uniqueCheckoutMenuItemIds },
          isRequired: true,
          deletedAt: null,
        },
        select: {
          id: true,
          menuItemId: true,
          name: true,
          minSelections: true,
          modifiers: {
            where: { deletedAt: null },
            select: { id: true },
          },
        },
      })

      if (requiredGroups.length > 0) {
        for (const item of items) {
          const groups = requiredGroups.filter(g => g.menuItemId === item.menuItemId)
          if (groups.length === 0) continue

          const itemModifiers = item.modifiers || []

          for (const group of groups) {
            const groupModifierIds = new Set(group.modifiers.map(m => m.id))
            let selectionCount = 0

            for (const mod of itemModifiers) {
              if (mod.modifierId && groupModifierIds.has(mod.modifierId)) {
                selectionCount++
              }
            }

            const minRequired = group.minSelections > 0 ? group.minSelections : 1
            if (selectionCount < minRequired) {
              const miName = menuItemMap.get(item.menuItemId)?.name ?? item.menuItemId
              return err(
                `Required modifier group "${group.name}" is not satisfied for item "${miName}" ` +
                `(requires ${minRequired}, got ${selectionCount})`,
                400
              )
            }
          }
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
    // Snapshot exclusive tax rate at order creation (decimal form)
    const exclusiveTaxRate = taxRate > 0 ? taxRate : 0
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
        return err('Delivery address is required')
      }
      if (!body.deliveryZip?.trim()) {
        return err('Delivery zip code is required')
      }

      // Check delivery enabled in settings
      const fullSettings = mergeWithDefaults(locSettings as any)
      const deliveryConfig = fullSettings.delivery ?? DEFAULT_DELIVERY
      if (!deliveryConfig.enabled) {
        return err('Delivery is not available')
      }

      // Query active delivery zones (raw SQL — DeliveryZone not in Prisma)
      // Include all zone-type fields so we can fall back to radius/polygon matching
      const zones: any[] = await venueDb.$queryRaw`SELECT id, "deliveryFee", "minimumOrder", "estimatedMinutes",
                "zipCodes", "zoneType", "centerLat", "centerLng",
                "radiusMiles", "polygonJson"
         FROM "DeliveryZone"
         WHERE "locationId" = ${locationId} AND "deletedAt" IS NULL AND "isActive" = true
         ORDER BY "sortOrder" ASC`

      // Match delivery address against zones.
      // Priority: iterate in sortOrder; try ZIP first, then radius/polygon fallback.
      const customerZip = body.deliveryZip.trim()
      const hasDeliveryCoords = body.deliveryLat != null && body.deliveryLng != null
      const delLat = hasDeliveryCoords ? Number(body.deliveryLat) : null
      const delLng = hasDeliveryCoords ? Number(body.deliveryLng) : null

      for (const zone of zones) {
        // --- Zipcode match (original logic) ---
        if (zone.zoneType === 'zipcode' && customerZip) {
          const zoneZips = Array.isArray(zone.zipCodes) ? zone.zipCodes : []
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

        // --- Radius match (requires lat/lng from client) ---
        if (zone.zoneType === 'radius' && hasDeliveryCoords
            && zone.centerLat != null && zone.centerLng != null && zone.radiusMiles != null) {
          const centerLat = Number(zone.centerLat)
          const centerLng = Number(zone.centerLng)
          const radiusMiles = Number(zone.radiusMiles)
          const distance = haversineDistance(delLat!, delLng!, centerLat, centerLng)
          if (distance <= radiusMiles) {
            matchedZone = {
              id: zone.id,
              deliveryFee: Number(zone.deliveryFee),
              minimumOrder: Number(zone.minimumOrder),
              estimatedMinutes: zone.estimatedMinutes,
            }
            break
          }
        }

        // --- Polygon match (requires lat/lng from client) ---
        if (zone.zoneType === 'polygon' && hasDeliveryCoords && zone.polygonJson) {
          const ring = getPolygonRing(zone.polygonJson)
          if (ring && pointInPolygon(delLat!, delLng!, ring)) {
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
      // NOTE: If the checkout request doesn't include deliveryLat/deliveryLng,
      // radius and polygon zones cannot be evaluated — only ZIP matching runs.
      // The client should geocode the delivery address and send coordinates.

      if (!matchedZone) {
        return err('Delivery not available for this address')
      }

      // Minimum order check (against discounted subtotal)
      if (matchedZone.minimumOrder > 0 && discountedSubtotal < matchedZone.minimumOrder) {
        return err(`Minimum order of $${matchedZone.minimumOrder.toFixed(2)} required for delivery`)
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
        return err('This location is not configured for online ordering yet', 503)
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
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct business day
    const checkoutTz = locationRec?.timezone || 'America/New_York'
    const businessDayStart = getCurrentBusinessDay(dayStartTime, checkoutTz).start

    // ── 7. Create the Order (atomic: order number lock + create in one tx) ────

    const now = new Date().toISOString()
    const seatTimestamps: Record<string, string> = { '1': now }

    const order = await venueDb.$transaction(async (tx) => {
      // Lock latest order row to prevent duplicate order numbers
      const lastOrderRows = await tx.$queryRaw<{ orderNumber: number }[]>`SELECT "orderNumber" FROM "Order" WHERE "locationId" = ${locationId} AND "createdAt" >= ${today} AND "createdAt" < ${tomorrow} ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE`
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
          exclusiveTaxRate,
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

    // ── 8. Charge via Datacap PayAPI (skip if gift card covers all) ────────────

    let payApiResult: any = null
    let achResult: PayApiAchResponse | null = null

    if (!skipDcPayment) {
      if (isAchPayment && body.achDetails) {
        // ── 8a. ACH payment flow ────────────────────────────────────────────
        try {
          achResult = await getPayApiClient().achAuthorize({
            routingNo:     body.achDetails.routingNumber,
            acctNo:        body.achDetails.accountNumber,
            acctType:      body.achDetails.accountType,
            amount:        chargeAmount.toFixed(2),
            invoiceNo:     order.orderNumber.toString(),
            custFirstName: body.achDetails.accountHolderFirstName,
            custLastName:  body.achDetails.accountHolderLastName,
            entryClass:    'Personal',
            // WEB = web-initiated ACH, S = single (not recurring)
            standardEntryClassCode: 'WEB',
            singleOrRecurring: 'S',
          })
        } catch (payErr) {
          // ACH error — soft-delete the order
          await venueDb.order.update({
            where: { id: order.id },
            data: { status: 'cancelled', deletedAt: new Date(), lastMutatedBy: 'cloud' },
          }).catch(err => log.warn({ err }, 'fire-and-forget failed in online.checkout'))
          console.error('[checkout] PayAPI ACH error:', payErr)
          return err('ACH payment processing failed. Please check your bank details and try again.', 502)
        }

        if (!isPayApiSuccess(achResult.status)) {
          // ACH declined — soft-delete the order, return 402
          await venueDb.order.update({
            where: { id: order.id },
            data: { status: 'cancelled', deletedAt: new Date(), lastMutatedBy: 'cloud' },
          }).catch(err => log.warn({ err }, 'fire-and-forget failed in online.checkout'))
          return NextResponse.json(
            {
              error: 'ACH payment declined. Please check your bank details or try a different account.',
              declineMessage: achResult.message,
            },
            { status: 402 }
          )
        }
      } else {
        // ── 8b. Card payment flow (existing) ─────────────────────────────────
        if (!token) {
          // Gift card didn't cover everything and no card token provided
          await venueDb.order.update({
            where: { id: order.id },
            data: { status: 'cancelled', deletedAt: new Date(), lastMutatedBy: 'cloud' },
          }).catch(err => log.warn({ err }, 'fire-and-forget failed in online.checkout'))
          return err('Payment token is required for the remaining balance')
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
          }).catch(err => log.warn({ err }, 'fire-and-forget failed in online.checkout'))
          console.error('[checkout] PayAPI error:', payErr)
          return err('Payment processing failed. Please try again.', 502)
        }
      }

      // ── 9. Handle payment result ─────────────────────────────────────────────

      if (payApiResult && !isPayApiSuccess(payApiResult.status)) {
        // Declined — soft-delete the order (BUG #389), return 402
        await venueDb.order.update({
          where: { id: order.id },
          data: { status: 'cancelled', deletedAt: new Date(), lastMutatedBy: 'cloud' },
        }).catch(err => log.warn({ err }, 'fire-and-forget failed in online.checkout'))
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

    if (achResult) {
      // TX-KEEP: CREATE — ACH payment record after PayAPI ACH approval
      // ACH settlements take 2-3 business days
      paymentOps.push(
        venueDb.payment.create({
          data: {
            locationId,
            orderId: order.id,
            employeeId,
            amount: chargeAmount - tip, // base amount (excl tip)
            tipAmount: tip,
            totalAmount: chargeAmount,
            paymentMethod: 'ach',
            // Store masked account info (last 4 digits only — never full account number)
            cardLast4: achResult.acctNo ? achResult.acctNo.slice(-4) : null,
            // Re-use cardBrand for account type (Checking/Savings)
            cardBrand: achResult.acctType ?? null,
            transactionId: achResult.invoiceNo ?? null,
            datacapRefNumber: achResult.refNo ?? null,
            entryMethod: 'ACH',
            status: 'completed',
            amountRequested: chargeAmount,
            amountAuthorized: parseFloat(achResult.authorized) || chargeAmount,
            lastMutatedBy: 'cloud',
          },
        })
      )
    } else if (payApiResult) {
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
            entryMethod: body.walletType ? 'Wallet' : 'Manual',
            walletType: body.walletType ?? null,
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
      void accrueOnlineLoyaltyPoints(venueDb, customer.id, totalPlusTip).catch(err => log.warn({ err }, 'Background task failed'))
    } catch (custErr) {
      // Customer upsert failure should not block order success
      console.error('[checkout] Customer upsert error:', custErr)
    }

    // ── 10b½. Create DeliveryOrder (raw SQL — not in Prisma) ────────────────

    if (body.orderType === 'delivery' && matchedZone) {
      try {
        const deliveryOrderId = crypto.randomUUID()
        deliveryTrackingToken = crypto.randomUUID()
        await venueDb.$queryRaw`
          INSERT INTO "DeliveryOrder" (
            id, "locationId", "orderId", status,
            "customerName", "customerPhone", "customerEmail",
            "deliveryAddress", "deliveryCity", "deliveryState", "deliveryZip",
            "deliveryInstructions", "deliveryFee", "zoneId",
            "estimatedMinutes", "trackingToken",
            "createdAt", "updatedAt"
          ) VALUES (${deliveryOrderId}, ${locationId}, ${order.id}, ${'pending'}, ${body.customerName}, ${body.customerPhone || ''}, ${body.customerEmail}, ${body.deliveryAddress}, ${body.deliveryCity || ''}, ${body.deliveryState || ''}, ${body.deliveryZip}, ${body.deliveryInstructions || ''}, ${deliveryFee}, ${matchedZone.id}, ${matchedZone.estimatedMinutes || 30}, ${deliveryTrackingToken}, ${new Date()}, ${new Date()})
        `
      } catch (deliveryErr) {
        // CRITICAL: DeliveryOrder creation failed AFTER payment was processed.
        // The order exists and is paid, but delivery will never be dispatched.
        // Flag for manual review so staff can handle it.
        log.error(
          { err: deliveryErr, orderId: order.id, locationId },
          'DeliveryOrder creation failed after payment — order needs manual review'
        )

        // Flag the order for manual attention
        void venueDb.order.update({
          where: { id: order.id },
          data: {
            metadata: {
              needsManualReview: true,
              deliveryCreationFailed: true,
              deliveryError: deliveryErr instanceof Error ? deliveryErr.message : 'Unknown error',
              failedAt: new Date().toISOString(),
            },
          },
        }).catch(flagErr => log.error({ err: flagErr }, 'Failed to flag order for manual review'))

        // Create audit trail for the failure
        void venueDb.auditLog.create({
          data: {
            locationId,
            action: 'delivery_order_creation_failed',
            entityType: 'order',
            entityId: order.id,
            details: {
              orderNumber: order.orderNumber,
              error: deliveryErr instanceof Error ? deliveryErr.message : 'Unknown error',
              customerName: body.customerName,
              deliveryAddress: body.deliveryAddress,
              paymentProcessed: true,
              severity: 'critical',
              resolution: 'Manual delivery dispatch required — payment already processed',
            },
          },
        }).catch(auditErr => log.error({ err: auditErr }, 'Failed to create delivery failure audit log'))

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
            method: skipDcPayment ? 'gift_card' : (achResult ? 'ach' : 'card'),
            amountCents: Math.round(total * 100),
            tipCents: Math.round(tip * 100),
            totalCents: Math.round(totalPlusTip * 100),
            cardBrand: achResult ? (achResult.acctType ?? null) : (payApiResult?.brand ?? body.cardBrand ?? null),
            cardLast4: achResult ? (achResult.acctNo ? achResult.acctNo.slice(-4) : null) : (payApiResult?.account ? payApiResult.account.slice(-4) : (body.cardLast4 ?? null)),
            status: 'approved',
          },
        },
        {
          type: 'ORDER_CLOSED' as const,
          payload: { closedStatus: 'paid' },
        },
      ])
    })().catch(err => log.warn({ err }, 'Background task failed'))

    const prepTimeMinutes =
      (onlineSettings?.prepTime as number | undefined) ?? 20

    return ok({
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
        // ACH settlement note — inform the customer about settlement timing
        paymentMethod: achResult ? 'ach' : 'card',
        achSettlementNote: achResult ? 'Your bank account will be debited within 2-3 business days.' : undefined,
      })
  } catch (error) {
    console.error('[POST /api/online/checkout] Error:', error)
    return err('An unexpected error occurred. Please try again.', 500)
  }
}
