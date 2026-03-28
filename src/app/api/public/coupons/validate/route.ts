/**
 * POST /api/public/coupons/validate
 *
 * Validates a coupon code and returns the calculated discount.
 * No authentication required — public endpoint for online ordering.
 *
 * Uses getDbForVenue(slug) for tenant isolation (same as other public routes).
 */

import { NextRequest } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { CouponValidateSchema } from '@/lib/site-api-schemas'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { err, ok } from '@/lib/api-response'

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)

  // Rate limit: reuse 'menu' bucket (30/min) — validation is lightweight
  const rateCheck = checkOnlineRateLimit(ip, 'coupon-validate', 'menu')
  if (!rateCheck.allowed) {
    return err('Too many requests. Please try again shortly.', 429)
  }

  let parsed
  try {
    const body = await request.json()
    parsed = CouponValidateSchema.parse(body)
  } catch {
    return err('Invalid request body')
  }

  const { code, slug, subtotal, customerId } = parsed

  try {
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return ok({ valid: false, reason: 'Location not found' })
    }

    // Find the location for this venue
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true },
    })
    if (!location) {
      return ok({ valid: false, reason: 'Location not found' })
    }
    const locationId = location.id

    // Look up coupon — case-insensitive
    const coupon = await venueDb.coupon.findFirst({
      where: {
        locationId,
        code: { equals: code, mode: 'insensitive' as any },
        deletedAt: null,
      },
      select: {
        id: true,
        discountType: true,
        discountValue: true,
        freeItemId: true,
        freeItem: { select: { name: true } },
        minimumOrder: true,
        maximumDiscount: true,
        usageLimit: true,
        usageCount: true,
        perCustomerLimit: true,
        validFrom: true,
        validUntil: true,
        isActive: true,
      },
    })

    if (!coupon) {
      return ok({ valid: false, reason: 'Coupon not found' })
    }

    // Validate: active
    if (!coupon.isActive) {
      return ok({ valid: false, reason: 'This coupon is no longer active' })
    }

    // Validate: date range
    const now = new Date()
    if (coupon.validFrom && now < coupon.validFrom) {
      return ok({ valid: false, reason: 'This coupon is not yet valid' })
    }
    if (coupon.validUntil && now > coupon.validUntil) {
      return ok({ valid: false, reason: 'This coupon has expired' })
    }

    // Validate: global usage limit
    if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
      return ok({ valid: false, reason: 'This coupon has reached its usage limit' })
    }

    // Validate: per-customer limit
    if (customerId && coupon.perCustomerLimit != null) {
      const customerUsageCount = await venueDb.couponRedemption.count({
        where: {
          couponId: coupon.id,
          customerId,
          deletedAt: null,
        },
      })
      if (customerUsageCount >= coupon.perCustomerLimit) {
        return ok({ valid: false, reason: 'You have already used this coupon the maximum number of times' })
      }
    }

    // Validate: minimum order
    if (coupon.minimumOrder != null && subtotal < Number(coupon.minimumOrder)) {
      return ok({
        valid: false,
        reason: `Minimum order of $${Number(coupon.minimumOrder).toFixed(2)} required`,
      })
    }

    // Calculate discount
    const discountType = coupon.discountType
    const discountValue = Number(coupon.discountValue)
    const maxDiscount = coupon.maximumDiscount != null ? Number(coupon.maximumDiscount) : null

    if (discountType === 'free_item') {
      return ok({
        valid: true,
        discount: 0,
        discountType: 'free_item',
        couponId: coupon.id,
        freeItemId: coupon.freeItemId,
        freeItemName: coupon.freeItem?.name ?? null,
      })
    }

    let discount: number
    if (discountType === 'percent') {
      discount = subtotal * discountValue / 100
    } else {
      // fixed
      discount = Math.min(discountValue, subtotal)
    }

    // Apply maximum discount cap
    if (maxDiscount != null && discount > maxDiscount) {
      discount = maxDiscount
    }

    // Round to 2 decimal places
    discount = Math.round(discount * 100) / 100

    return ok({
      valid: true,
      discount,
      discountType,
      couponId: coupon.id,
    })
  } catch (error) {
    console.error('[POST /api/public/coupons/validate] Error:', error)
    return err('Failed to validate coupon', 500)
  }
}
