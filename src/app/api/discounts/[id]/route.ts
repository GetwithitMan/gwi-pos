import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth'
import { notifyDataChanged } from '@/lib/cloud-notify'

// GET - Get a single discount by ID
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const discount = await db.discountRule.findUnique({
      where: { id },
    })

    if (!discount) {
      return NextResponse.json(
        { error: 'Discount not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: {
      discount: {
        id: discount.id,
        name: discount.name,
        displayText: discount.displayText,
        description: discount.description,
        discountType: discount.discountType,
        discountConfig: discount.discountConfig,
        triggerConfig: discount.triggerConfig,
        scheduleConfig: discount.scheduleConfig,
        priority: discount.priority,
        isStackable: discount.isStackable,
        requiresApproval: discount.requiresApproval,
        maxPerOrder: discount.maxPerOrder,
        isActive: discount.isActive,
        isAutomatic: discount.isAutomatic,
        createdAt: discount.createdAt.toISOString(),
        updatedAt: discount.updatedAt.toISOString(),
      },
    } })
  } catch (error) {
    console.error('Failed to fetch discount:', error)
    return NextResponse.json(
      { error: 'Failed to fetch discount' },
      { status: 500 }
    )
  }
})

// PUT - Update a discount
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      name,
      displayText,
      description,
      discountType,
      discountConfig,
      triggerConfig,
      scheduleConfig,
      priority,
      isStackable,
      requiresApproval,
      maxPerOrder,
      isActive,
      isAutomatic,
      isEmployeeDiscount,
      requestingEmployeeId,
    } = body

    // Check discount exists
    const existing = await db.discountRule.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Discount not found' },
        { status: 404 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, existing.locationId, PERMISSIONS.SETTINGS_MENU)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const discount = await db.discountRule.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(displayText !== undefined && { displayText }),
        ...(description !== undefined && { description }),
        ...(discountType !== undefined && { discountType }),
        ...(discountConfig !== undefined && { discountConfig }),
        ...(triggerConfig !== undefined && { triggerConfig }),
        ...(scheduleConfig !== undefined && { scheduleConfig: scheduleConfig || Prisma.JsonNull }),
        ...(priority !== undefined && { priority }),
        ...(isStackable !== undefined && { isStackable }),
        ...(requiresApproval !== undefined && { requiresApproval }),
        ...(maxPerOrder !== undefined && { maxPerOrder }),
        ...(isActive !== undefined && { isActive }),
        ...(isAutomatic !== undefined && { isAutomatic }),
        ...(isEmployeeDiscount !== undefined && { isEmployeeDiscount }),
      },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'discounts', action: 'updated', entityId: discount.id })

    return NextResponse.json({ data: {
      discount: {
        id: discount.id,
        name: discount.name,
        displayText: discount.displayText,
        discountType: discount.discountType,
        discountConfig: discount.discountConfig,
        isActive: discount.isActive,
        updatedAt: discount.updatedAt.toISOString(),
      },
    } })
  } catch (error) {
    console.error('Failed to update discount:', error)
    return NextResponse.json(
      { error: 'Failed to update discount' },
      { status: 500 }
    )
  }
})

// DELETE - Delete a discount
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const requestingEmployeeId = request.nextUrl.searchParams.get('requestingEmployeeId')

    // Check discount exists
    const discount = await db.discountRule.findUnique({
      where: { id },
    })

    if (!discount) {
      return NextResponse.json(
        { error: 'Discount not found' },
        { status: 404 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, discount.locationId, PERMISSIONS.SETTINGS_MENU)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    await db.discountRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: discount.locationId, domain: 'discounts', action: 'deleted', entityId: id })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete discount:', error)
    return NextResponse.json(
      { error: 'Failed to delete discount' },
      { status: 500 }
    )
  }
})
