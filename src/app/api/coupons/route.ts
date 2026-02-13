import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List all coupons for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const activeOnly = searchParams.get('activeOnly') === 'true'
    const code = searchParams.get('code')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // If code is provided, look up specific coupon for redemption
    if (code) {
      const coupon = await db.coupon.findFirst({
        where: {
          locationId,
          code: code.toUpperCase(),
          isActive: true,
        },
        include: {
          _count: {
            select: { redemptions: true }
          }
        }
      })

      if (!coupon) {
        return NextResponse.json(
          { error: 'Invalid coupon code' },
          { status: 404 }
        )
      }

      // Check validity
      const now = new Date()
      if (coupon.validFrom && now < coupon.validFrom) {
        return NextResponse.json(
          { error: 'Coupon not yet valid' },
          { status: 400 }
        )
      }
      if (coupon.validUntil && now > coupon.validUntil) {
        return NextResponse.json(
          { error: 'Coupon has expired' },
          { status: 400 }
        )
      }

      // Check usage limit
      if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
        return NextResponse.json(
          { error: 'Coupon usage limit reached' },
          { status: 400 }
        )
      }

      return NextResponse.json({
        ...coupon,
        discountValue: Number(coupon.discountValue),
        minimumOrder: coupon.minimumOrder ? Number(coupon.minimumOrder) : null,
        maximumDiscount: coupon.maximumDiscount ? Number(coupon.maximumDiscount) : null,
      })
    }

    const coupons = await db.coupon.findMany({
      where: {
        locationId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      include: {
        _count: {
          select: { redemptions: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(
      coupons.map(coupon => ({
        ...coupon,
        discountValue: Number(coupon.discountValue),
        minimumOrder: coupon.minimumOrder ? Number(coupon.minimumOrder) : null,
        maximumDiscount: coupon.maximumDiscount ? Number(coupon.maximumDiscount) : null,
      }))
    )
  } catch (error) {
    console.error('Failed to fetch coupons:', error)
    return NextResponse.json(
      { error: 'Failed to fetch coupons' },
      { status: 500 }
    )
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
      return NextResponse.json(
        { error: 'Location ID, code, name, discount type, and discount value are required' },
        { status: 400 }
      )
    }

    // Check if code already exists
    const existing = await db.coupon.findFirst({
      where: {
        locationId,
        code: code.toUpperCase(),
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Coupon code already exists' },
        { status: 400 }
      )
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
        createdBy,
      },
    })

    return NextResponse.json({
      ...coupon,
      discountValue: Number(coupon.discountValue),
      minimumOrder: coupon.minimumOrder ? Number(coupon.minimumOrder) : null,
      maximumDiscount: coupon.maximumDiscount ? Number(coupon.maximumDiscount) : null,
    })
  } catch (error) {
    console.error('Failed to create coupon:', error)
    return NextResponse.json(
      { error: 'Failed to create coupon' },
      { status: 500 }
    )
  }
})
