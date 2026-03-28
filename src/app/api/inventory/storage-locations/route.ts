import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

// GET - List storage locations
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const activeOnly = searchParams.get('activeOnly') !== 'false'

    if (!locationId) {
      return err('Location ID required')
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (activeOnly) where.isActive = true

    const storageLocations = await db.storageLocation.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: { inventoryItems: true },
        },
      },
    })

    return ok({ storageLocations })
  } catch (error) {
    console.error('Storage locations list error:', error)
    return err('Failed to fetch storage locations', 500)
  }
})

// POST - Create storage location
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, name, description, sortOrder } = body

    if (!locationId || !name) {
      return err('Location ID and name required')
    }

    // Get max sort order if not provided
    let order = sortOrder
    if (order === undefined) {
      const maxOrder = await db.storageLocation.findFirst({
        where: { locationId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      })
      order = (maxOrder?.sortOrder ?? 0) + 1
    }

    const storageLocation = await db.storageLocation.create({
      data: {
        locationId,
        name,
        description,
        sortOrder: order,
      },
    })

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'created', entityId: storageLocation.id })
    void pushUpstream()

    return ok({ storageLocation })
  } catch (error) {
    console.error('Create storage location error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('Storage location with this name already exists')
    }
    return err('Failed to create storage location', 500)
  }
}))
