import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { SYSTEM_ORDER_TYPES } from '@/types/order-types'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { created, err, ok } from '@/lib/api-response'

// GET - List all order types for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    if (!locationId) {
      return err('locationId is required')
    }

    const orderTypes = await db.orderType.findMany({
      where: {
        locationId,
        // Only return active order types unless explicitly asked for all
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { sortOrder: 'asc' },
    })

    return ok({ orderTypes })
  } catch (error) {
    console.error('[Order Types API] Error:', error)
    return err('Failed to fetch order types', 500, String(error))
  }
})

// POST - Create a new order type
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
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
      return err('locationId, name, and slug are required')
    }

    // Check if slug already exists
    const existing = await db.orderType.findUnique({
      where: {
        locationId_slug: { locationId, slug },
      },
    })

    if (existing) {
      return err('An order type with this slug already exists', 409)
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

    void notifyDataChanged({ locationId, domain: 'order-types', action: 'created', entityId: orderType.id })
    void pushUpstream()

    return created({ orderType })
  } catch (error) {
    console.error('Failed to create order type:', error)
    return err('Failed to create order type', 500)
  }
}))

// PUT - Initialize system order types for a location
export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId } = body

    if (!locationId) {
      return err('locationId is required')
    }

    // Check if system types already exist
    const existingTypes = await db.orderType.findMany({
      where: {
        locationId,
        isSystem: true,
      },
    })

    if (existingTypes.length > 0) {
      return ok({
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

    for (const ot of createdTypes) {
      void notifyDataChanged({ locationId, domain: 'order-types', action: 'created', entityId: ot.id })
      void pushUpstream()
    }

    return ok({
      message: 'System order types initialized',
      orderTypes: createdTypes,
    })
  } catch (error) {
    console.error('Failed to initialize system order types:', error)
    return err('Failed to initialize system order types', 500)
  }
}))
