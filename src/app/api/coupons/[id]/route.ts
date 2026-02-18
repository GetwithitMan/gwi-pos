import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get a specific coupon
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const coupon = await db.coupon.findUnique({
      where: { id },
      include: {
        redemptions: {
          take: 50,
          orderBy: { redeemedAt: 'desc' },
        },
        _count: {
          select: { redemptions: true }
        }
      },
    })

    if (!coupon) {
      return NextResponse.json(
        { error: 'Coupon not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: {
      ...coupon,
      discountValue: Number(coupon.discountValue),
      minimumOrder: coupon.minimumOrder ? Number(coupon.minimumOrder) : null,
      maximumDiscount: coupon.maximumDiscount ? Number(coupon.maximumDiscount) : null,
      redemptions: coupon.redemptions.map(r => ({
        ...r,
        discountAmount: Number(r.discountAmount),
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch coupon:', error)
    return NextResponse.json(
      { error: 'Failed to fetch coupon' },
      { status: 500 }
    )
  }
})

// PUT - Update coupon or perform action
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, ...updateData } = body

    const coupon = await db.coupon.findUnique({
      where: { id },
    })

    if (!coupon) {
      return NextResponse.json(
        { error: 'Coupon not found' },
        { status: 404 }
      )
    }

    // Handle actions
    if (action) {
      switch (action) {
        case 'activate':
          const activated = await db.coupon.update({
            where: { id },
            data: { isActive: true },
          })
          return NextResponse.json({ data: {
            ...activated,
            discountValue: Number(activated.discountValue),
          } })

        case 'deactivate':
          const deactivated = await db.coupon.update({
            where: { id },
            data: { isActive: false },
          })
          return NextResponse.json({ data: {
            ...deactivated,
            discountValue: Number(deactivated.discountValue),
          } })

        case 'redeem':
          // Validate and redeem coupon
          const { orderId, customerId, discountAmount, employeeId } = body

          if (!orderId || discountAmount === undefined) {
            return NextResponse.json(
              { error: 'Order ID and discount amount required' },
              { status: 400 }
            )
          }

          // Check validity
          const now = new Date()
          if (!coupon.isActive) {
            return NextResponse.json(
              { error: 'Coupon is not active' },
              { status: 400 }
            )
          }
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
          if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
            return NextResponse.json(
              { error: 'Coupon usage limit reached' },
              { status: 400 }
            )
          }

          // Check per-customer limit
          if (customerId && coupon.perCustomerLimit) {
            const customerRedemptions = await db.couponRedemption.count({
              where: {
                couponId: id,
                customerId,
              },
            })
            if (customerRedemptions >= coupon.perCustomerLimit) {
              return NextResponse.json(
                { error: 'Customer has exceeded usage limit for this coupon' },
                { status: 400 }
              )
            }
          }

          // Check single use
          if (customerId && coupon.singleUse) {
            const previousUse = await db.couponRedemption.findFirst({
              where: {
                couponId: id,
                customerId,
              },
            })
            if (previousUse) {
              return NextResponse.json(
                { error: 'This coupon can only be used once per customer' },
                { status: 400 }
              )
            }
          }

          // Create redemption record
          await db.couponRedemption.create({
            data: {
              locationId: coupon.locationId,
              couponId: id,
              orderId,
              customerId,
              discountAmount,
              redeemedBy: employeeId,
            },
          })

          // Update usage count
          const updatedCoupon = await db.coupon.update({
            where: { id },
            data: {
              usageCount: { increment: 1 },
            },
          })

          return NextResponse.json({ data: {
            success: true,
            coupon: {
              ...updatedCoupon,
              discountValue: Number(updatedCoupon.discountValue),
            },
          } })

        default:
          return NextResponse.json(
            { error: 'Invalid action' },
            { status: 400 }
          )
      }
    }

    // Regular update
    const updated = await db.coupon.update({
      where: { id },
      data: {
        name: updateData.name,
        description: updateData.description,
        discountType: updateData.discountType,
        discountValue: updateData.discountValue,
        freeItemId: updateData.freeItemId,
        minimumOrder: updateData.minimumOrder,
        maximumDiscount: updateData.maximumDiscount,
        appliesTo: updateData.appliesTo,
        categoryIds: updateData.categoryIds,
        itemIds: updateData.itemIds,
        usageLimit: updateData.usageLimit,
        perCustomerLimit: updateData.perCustomerLimit,
        singleUse: updateData.singleUse,
        validFrom: updateData.validFrom ? new Date(updateData.validFrom) : null,
        validUntil: updateData.validUntil ? new Date(updateData.validUntil) : null,
        isActive: updateData.isActive,
      },
    })

    return NextResponse.json({ data: {
      ...updated,
      discountValue: Number(updated.discountValue),
      minimumOrder: updated.minimumOrder ? Number(updated.minimumOrder) : null,
      maximumDiscount: updated.maximumDiscount ? Number(updated.maximumDiscount) : null,
    } })
  } catch (error) {
    console.error('Failed to update coupon:', error)
    return NextResponse.json(
      { error: 'Failed to update coupon' },
      { status: 500 }
    )
  }
})

// DELETE - Delete a coupon
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check if coupon has redemptions
    const redemptionCount = await db.couponRedemption.count({
      where: { couponId: id },
    })

    if (redemptionCount > 0) {
      // Soft delete by deactivating
      await db.coupon.update({
        where: { id },
        data: { isActive: false },
      })
      return NextResponse.json({ data: {
        success: true,
        message: 'Coupon has redemptions and was deactivated instead of deleted',
      } })
    }

    await db.coupon.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete coupon:', error)
    return NextResponse.json(
      { error: 'Failed to delete coupon' },
      { status: 500 }
    )
  }
})
