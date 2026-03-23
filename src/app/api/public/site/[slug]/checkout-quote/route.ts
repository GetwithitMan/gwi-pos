/**
 * POST /api/public/site/[slug]/checkout-quote — Server-authoritative pricing preview
 *
 * No auth. Validates cart items, computes server-side prices, tax, tip,
 * surcharge, and coupon discount. Flags unavailable items and price changes.
 *
 * Cache-Control: private, no-store (dynamic pricing).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { getLocationTaxRate, calculateSplitTax, isItemTaxInclusive, type TaxInclusiveSettings } from '@/lib/order-calculations'
import { computeIsOrderableOnline } from '@/lib/online-availability'

export const dynamic = 'force-dynamic'

// ── Request Body ─────────────────────────────────────────────────────────────

interface QuoteItem {
  menuItemId: string
  quantity: number
  modifiers: Array<{
    modifierId: string
    price: number
  }>
  pizzaData?: Record<string, unknown>
}

interface QuoteBody {
  slug: string
  items: QuoteItem[]
  orderType: 'pickup' | 'delivery' | 'dine_in'
  couponCode?: string
  tipPercent?: number
  tipAmount?: number
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  context: any,
) {
  try {
    const { slug } = (await context.params) as { slug: string }

    if (!slug) {
      return NextResponse.json({ error: 'Venue slug is required' }, { status: 400 })
    }

    let body: QuoteBody
    try {
      body = (await request.json()) as QuoteBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { items, orderType, couponCode, tipPercent, tipAmount } = body

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
    }

    // ── Resolve venue DB ─────────────────────────────────────────────────────

    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, settings: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const locationId = location.id
    const locSettings = location.settings as Record<string, unknown> | null
    const onlineSettings = locSettings?.onlineOrdering as Record<string, unknown> | null

    if (!onlineSettings?.enabled) {
      return NextResponse.json(
        { error: 'Online ordering is not currently available' },
        { status: 503 }
      )
    }

    // ── Fetch menu items from DB (never trust client prices) ─────────────────

    const menuItemIds = items.map(i => i.menuItemId)
    const menuItems = await venueDb.menuItem.findMany({
      where: {
        id: { in: menuItemIds },
        locationId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        price: true,
        onlinePrice: true,
        isActive: true,
        showOnline: true,
        isAvailable: true,
        availableFrom: true,
        availableTo: true,
        availableDays: true,
        currentStock: true,
        trackInventory: true,
        lowStockAlert: true,
        category: { select: { categoryType: true } },
      },
    })

    const menuItemMap = new Map(menuItems.map(mi => [mi.id, mi]))

    // ── Fetch modifiers from DB ──────────────────────────────────────────────

    const allModifierIds = items
      .flatMap(item => item.modifiers.map(m => m.modifierId))
      .filter(Boolean)

    const modifierMap = new Map<string, { id: string; name: string; price: unknown }>()

    if (allModifierIds.length > 0) {
      const dbModifiers = await venueDb.modifier.findMany({
        where: {
          id: { in: allModifierIds },
          locationId,
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          price: true,
        },
      })
      for (const m of dbModifiers) {
        modifierMap.set(m.id, m)
      }
    }

    // ── Validate items + compute server prices ───────────────────────────────

    const unavailableItems: Array<{ menuItemId: string; reason: string }> = []
    const validatedItems: Array<{ menuItemId: string; serverPrice: number }> = []

    const taxSettings = locSettings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number; taxInclusiveLiquor?: boolean; taxInclusiveFood?: boolean } } | null
    const taxRate = getLocationTaxRate(taxSettings)
    const taxIncSettings: TaxInclusiveSettings = {
      taxInclusiveLiquor: taxSettings?.tax?.taxInclusiveLiquor ?? false,
      taxInclusiveFood: taxSettings?.tax?.taxInclusiveFood ?? false,
    }

    let subtotal = 0
    let inclusiveSubtotal = 0
    let exclusiveSubtotal = 0
    let clientSubtotal = 0

    for (const item of items) {
      const mi = menuItemMap.get(item.menuItemId)

      // Item not found in DB
      if (!mi) {
        unavailableItems.push({ menuItemId: item.menuItemId, reason: 'Item not found' })
        continue
      }

      // Check availability
      if (!mi.isActive || !mi.showOnline) {
        unavailableItems.push({ menuItemId: item.menuItemId, reason: 'Item is not available for online ordering' })
        continue
      }

      const orderable = computeIsOrderableOnline({
        showOnline: mi.showOnline,
        isAvailable: mi.isAvailable,
        availableFrom: mi.availableFrom,
        availableTo: mi.availableTo,
        availableDays: mi.availableDays,
        currentStock: mi.currentStock,
        trackInventory: mi.trackInventory ?? false,
        lowStockAlert: mi.lowStockAlert,
      })

      if (!orderable) {
        unavailableItems.push({ menuItemId: item.menuItemId, reason: 'Item is currently unavailable' })
        continue
      }

      // Compute server price
      const basePrice = mi.onlinePrice != null ? Number(mi.onlinePrice) : Number(mi.price)
      const modsTotal = item.modifiers.reduce((sum, mod) => {
        const dbMod = modifierMap.get(mod.modifierId)
        return sum + (dbMod ? Number(dbMod.price) : 0)
      }, 0)
      const serverLinePrice = basePrice + modsTotal
      const lineTotal = serverLinePrice * item.quantity

      subtotal += lineTotal
      validatedItems.push({ menuItemId: item.menuItemId, serverPrice: serverLinePrice })

      // Track client-sent price for comparison
      const clientModsTotal = item.modifiers.reduce((sum, mod) => sum + mod.price, 0)
      clientSubtotal += clientModsTotal * item.quantity

      // Split by tax-inclusive status
      const itemInclusive = isItemTaxInclusive(mi.category?.categoryType, taxIncSettings)
      if (itemInclusive) {
        inclusiveSubtotal += lineTotal
      } else {
        exclusiveSubtotal += lineTotal
      }
    }

    // ── Tax calculation ──────────────────────────────────────────────────────

    const inclusiveTaxRate = taxSettings?.tax?.inclusiveTaxRate != null
      ? taxSettings.tax.inclusiveTaxRate / 100 : undefined
    const { taxFromExclusive, totalTax: taxAmount } = calculateSplitTax(
      inclusiveSubtotal, exclusiveSubtotal, taxRate, inclusiveTaxRate
    )

    // ── Tip calculation ──────────────────────────────────────────────────────

    let computedTip = 0
    if (typeof tipAmount === 'number' && tipAmount >= 0) {
      computedTip = Math.round(tipAmount * 100) / 100
    } else if (typeof tipPercent === 'number' && tipPercent >= 0) {
      computedTip = Math.round(subtotal * (tipPercent / 100) * 100) / 100
    }

    // ── Surcharge ────────────────────────────────────────────────────────────

    let surchargeAmount = 0
    const surchargeType = onlineSettings?.surchargeType as string | null | undefined
    const surchargeValue = Number(onlineSettings?.surchargeAmount ?? 0)

    if (surchargeType === 'flat' && surchargeValue > 0) {
      surchargeAmount = surchargeValue
    } else if (surchargeType === 'percent' && surchargeValue > 0) {
      surchargeAmount = Math.round(subtotal * (surchargeValue / 100) * 100) / 100
    }

    // ── Coupon validation ────────────────────────────────────────────────────

    let couponDiscount = 0
    if (couponCode) {
      try {
        const coupon = await venueDb.coupon.findFirst({
          where: {
            locationId,
            code: couponCode.trim().toUpperCase(),
            isActive: true,
            deletedAt: null,
          },
          select: {
            id: true,
            discountType: true,
            discountValue: true,
            minimumOrder: true,
            maximumDiscount: true,
            usageLimit: true,
            usageCount: true,
            validFrom: true,
            validUntil: true,
          },
        })

        if (coupon) {
          const now = new Date()
          const inWindow = (!coupon.validFrom || now >= coupon.validFrom) &&
                           (!coupon.validUntil || now <= coupon.validUntil)
          const underUsageLimit = !coupon.usageLimit || coupon.usageCount < coupon.usageLimit
          const meetsMin = !coupon.minimumOrder || subtotal >= Number(coupon.minimumOrder)

          if (inWindow && underUsageLimit && meetsMin) {
            if (coupon.discountType === 'percent') {
              couponDiscount = Math.round(subtotal * (Number(coupon.discountValue) / 100) * 100) / 100
            } else if (coupon.discountType === 'fixed') {
              couponDiscount = Math.min(Number(coupon.discountValue), subtotal)
            }

            // Apply max discount cap
            if (coupon.maximumDiscount && couponDiscount > Number(coupon.maximumDiscount)) {
              couponDiscount = Number(coupon.maximumDiscount)
            }
          }
        }
      } catch {
        // Coupon validation failure is non-fatal — proceed without discount
      }
    }

    // ── Delivery fee ─────────────────────────────────────────────────────────

    const deliveryFee = orderType === 'delivery'
      ? Number(onlineSettings?.deliveryFee ?? 0)
      : 0

    // ── Price change detection ───────────────────────────────────────────────
    // Compare server subtotal vs sum of what client prices would be
    // If diff > $0.50, flag it

    const priceChanged = Math.abs(subtotal - clientSubtotal) > 0.50

    // ── Total ────────────────────────────────────────────────────────────────

    const total = subtotal + taxFromExclusive + computedTip + surchargeAmount + deliveryFee - couponDiscount

    const response = {
      subtotal: Math.round(subtotal * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      tipAmount: computedTip,
      surchargeAmount: Math.round(surchargeAmount * 100) / 100,
      couponDiscount: Math.round(couponDiscount * 100) / 100,
      deliveryFee: Math.round(deliveryFee * 100) / 100,
      total: Math.round(total * 100) / 100,
      priceChanged,
      unavailableItems,
      validatedItems,
    }

    return NextResponse.json({ data: response }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('[POST /api/public/site/[slug]/checkout-quote] Error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
