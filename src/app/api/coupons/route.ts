import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok, unauthorized } from '@/lib/api-response'

// GET - List all coupons for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const activeOnly = searchParams.get('activeOnly') === 'true'
    const code = searchParams.get('code')

    if (!locationId) {
      return err('Location ID is required')
    }

    // If code is provided, look up specific coupon for redemption
    if (code) {
      const coupon = await db.coupon.findFirst({
        where: {
          locationId,
          code: code.toUpperCase(),
          isActive: true,
          deletedAt: null,
        },
        include: {
          _count: {
            select: { redemptions: true }
          }
        }
      })

      if (!coupon) {
        return notFound('Invalid coupon code')
      }

      // Check validity
      const now = new Date()
      if (coupon.validFrom && now < coupon.validFrom) {
        return err('Coupon not yet valid')
      }
      if (coupon.validUntil && now > coupon.validUntil) {
        return err('Coupon has expired')
      }

      // Check usage limit
      if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
        return err('Coupon usage limit reached')
      }

      return ok({
        ...coupon,
        discountValue: Number(coupon.discountValue),
        minimumOrder: coupon.minimumOrder ? Number(coupon.minimumOrder) : null,
        maximumDiscount: coupon.maximumDiscount ? Number(coupon.maximumDiscount) : null,
      })
    }

    const coupons = await db.coupon.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(activeOnly ? { isActive: true } : {}),
      },
      include: {
        _count: {
          select: { redemptions: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    })

    return ok(coupons.map(coupon => ({
        ...coupon,
        discountValue: Number(coupon.discountValue),
        minimumOrder: coupon.minimumOrder ? Number(coupon.minimumOrder) : null,
        maximumDiscount: coupon.maximumDiscount ? Number(coupon.maximumDiscount) : null,
      })))
  } catch (error) {
    console.error('Failed to fetch coupons:', error)
    return err('Failed to fetch coupons', 500)
  }
})

// POST - Create a new coupon
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      code,
      name,
      description,
      discountType,
      discountValue,
      freeItemId,
      minimumOrder,
      maximumDiscount,
      appliesTo,
      categoryIds,
      itemIds,
      usageLimit,
      perCustomerLimit,
      singleUse,
      validFrom,
      validUntil,
      createdBy,
    } = body

    if (!locationId || !code || !name || !discountType || discountValue === undefined) {
      return err('Location ID, code, name, discount type, and discount value are required')
    }

    // Auth check — require manager.discounts permission for coupon management
    const actor = await getActorFromRequest(request)
    if (!actor.employeeId) {
      return unauthorized('Authentication required')
    }
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Check if code already exists
    const existing = await db.coupon.findFirst({
      where: {
        locationId,
        code: code.toUpperCase(),
      },
    })

    if (existing) {
      return err('Coupon code already exists')
    }

    const coupon = await db.coupon.create({
      data: {
        locationId,
        code: code.toUpperCase(),
        name,
        description,
        discountType,
        discountValue,
        freeItemId,
        minimumOrder,
        maximumDiscount,
        appliesTo: appliesTo || 'order',
        categoryIds,
        itemIds,
        usageLimit,
        perCustomerLimit,
        singleUse: singleUse || false,
        validFrom: validFrom ? new Date(validFrom) : null,
        validUntil: validUntil ? new Date(validUntil) : null,
        createdBy: actor.employeeId,
      },
    })

    void notifyDataChanged({ locationId, domain: 'coupons', action: 'created', entityId: coupon.id })
    void pushUpstream()

    return ok({
      ...coupon,
      discountValue: Number(coupon.discountValue),
      minimumOrder: coupon.minimumOrder ? Number(coupon.minimumOrder) : null,
      maximumDiscount: coupon.maximumDiscount ? Number(coupon.maximumDiscount) : null,
    })
  } catch (error) {
    console.error('Failed to create coupon:', error)
    return err('Failed to create coupon', 500)
  }
})
