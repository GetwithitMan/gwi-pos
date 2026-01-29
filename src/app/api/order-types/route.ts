import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { SYSTEM_ORDER_TYPES } from '@/types/order-types'

// GET - List all order types for a location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    console.log('[Order Types API] GET request, locationId:', locationId, 'includeInactive:', includeInactive)

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    const orderTypes = await db.orderType.findMany({
      where: {
        locationId,
        // Only return active order types unless explicitly asked for all
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { sortOrder: 'asc' },
    })

    console.log('[Order Types API] Found', orderTypes.length, 'order types')

    return NextResponse.json({ orderTypes })
  } catch (error) {
    console.error('[Order Types API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch order types', details: String(error) },
      { status: 500 }
    )
  }
}

// POST - Create a new order type
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      slug,
      description,
      color,
      icon,
      sortOrder = 0,
      requiredFields = {},
      optionalFields = {},
      fieldDefinitions = {},
      workflowRules = {},
      kdsConfig = {},
      printConfig = {},
    } = body

    if (!locationId || !name || !slug) {
      return NextResponse.json(
        { error: 'locationId, name, and slug are required' },
        { status: 400 }
      )
    }

    // Check if slug already exists
    const existing = await db.orderType.findUnique({
      where: {
        locationId_slug: { locationId, slug },
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'An order type with this slug already exists' },
        { status: 409 }
      )
    }

    const orderType = await db.orderType.create({
      data: {
        locationId,
        name,
        slug,
        description,
        color,
        icon,
        sortOrder,
        isSystem: false,
        requiredFields,
        optionalFields,
        fieldDefinitions,
        workflowRules,
        kdsConfig,
        printConfig,
      },
    })

    return NextResponse.json({ orderType }, { status: 201 })
  } catch (error) {
    console.error('Failed to create order type:', error)
    return NextResponse.json(
      { error: 'Failed to create order type' },
      { status: 500 }
    )
  }
}

// PUT - Initialize system order types for a location
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Check if system types already exist
    const existingTypes = await db.orderType.findMany({
      where: {
        locationId,
        isSystem: true,
      },
    })

    if (existingTypes.length > 0) {
      return NextResponse.json({
        message: 'System order types already initialized',
        orderTypes: existingTypes,
      })
    }

    // Create system order types
    const createdTypes = []
    for (const typeConfig of SYSTEM_ORDER_TYPES) {
      const orderType = await db.orderType.create({
        data: {
          locationId,
          name: typeConfig.name!,
          slug: typeConfig.slug!,
          icon: typeConfig.icon,
          color: typeConfig.color,
          sortOrder: typeConfig.sortOrder!,
          isActive: true,
          isSystem: true,
          requiredFields: typeConfig.requiredFields as unknown as Prisma.InputJsonValue,
          optionalFields: typeConfig.optionalFields as unknown as Prisma.InputJsonValue,
          fieldDefinitions: typeConfig.fieldDefinitions as unknown as Prisma.InputJsonValue,
          workflowRules: typeConfig.workflowRules as unknown as Prisma.InputJsonValue,
          kdsConfig: typeConfig.kdsConfig as unknown as Prisma.InputJsonValue,
          printConfig: typeConfig.printConfig as unknown as Prisma.InputJsonValue,
        },
      })
      createdTypes.push(orderType)
    }

    return NextResponse.json({
      message: 'System order types initialized',
      orderTypes: createdTypes,
    })
  } catch (error) {
    console.error('Failed to initialize system order types:', error)
    return NextResponse.json(
      { error: 'Failed to initialize system order types' },
      { status: 500 }
    )
  }
}
