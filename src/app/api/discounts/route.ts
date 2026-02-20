import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { withVenue } from '@/lib/with-venue'

// GET - List all discount rules for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const activeOnly = searchParams.get('activeOnly') === 'true'
    const manualOnly = searchParams.get('manualOnly') === 'true'
    const employeeOnly = searchParams.get('employeeOnly') === 'true'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const where: {
      locationId: string
      isActive?: boolean
      isAutomatic?: boolean
      isEmployeeDiscount?: boolean
    } = { locationId }

    if (activeOnly) {
      where.isActive = true
    }

    if (manualOnly) {
      where.isAutomatic = false
    }

    if (employeeOnly) {
      where.isEmployeeDiscount = true
    }

    const discounts = await db.discountRule.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { name: 'asc' },
      ],
    })

    return NextResponse.json({ data: {
      discounts: discounts.map(d => ({
        id: d.id,
        name: d.name,
        displayText: d.displayText,
        description: d.description,
        discountType: d.discountType,
        discountConfig: d.discountConfig,
        triggerConfig: d.triggerConfig,
        scheduleConfig: d.scheduleConfig,
        priority: d.priority,
        isStackable: d.isStackable,
        requiresApproval: d.requiresApproval,
        maxPerOrder: d.maxPerOrder,
        isActive: d.isActive,
        isAutomatic: d.isAutomatic,
        isEmployeeDiscount: d.isEmployeeDiscount,
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch discounts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch discounts' },
      { status: 500 }
    )
  }
})

// POST - Create a new discount rule
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
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
    } = body as {
      locationId: string
      name: string
      displayText: string
      description?: string
      discountType: string
      discountConfig: {
        type: 'percent' | 'fixed'
        value: number
        maxAmount?: number
      }
      triggerConfig?: object
      scheduleConfig?: object
      priority?: number
      isStackable?: boolean
      requiresApproval?: boolean
      maxPerOrder?: number
      isActive?: boolean
      isAutomatic?: boolean
      isEmployeeDiscount?: boolean
    }

    if (!locationId || !name || !displayText || !discountType || !discountConfig) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const discount = await db.discountRule.create({
      data: {
        locationId,
        name,
        displayText,
        description: description || null,
        discountType,
        discountConfig,
        triggerConfig: triggerConfig || {},
        scheduleConfig: scheduleConfig || Prisma.JsonNull,
        priority: priority || 0,
        isStackable: isStackable ?? true,
        requiresApproval: requiresApproval ?? false,
        maxPerOrder: maxPerOrder || null,
        isActive: isActive ?? true,
        isAutomatic: isAutomatic ?? false,
        isEmployeeDiscount: isEmployeeDiscount ?? false,
      },
    })

    return NextResponse.json({ data: {
      id: discount.id,
      name: discount.name,
      displayText: discount.displayText,
      discountType: discount.discountType,
      discountConfig: discount.discountConfig,
      isActive: discount.isActive,
    } })
  } catch (error) {
    console.error('Failed to create discount:', error)
    return NextResponse.json(
      { error: 'Failed to create discount' },
      { status: 500 }
    )
  }
})
