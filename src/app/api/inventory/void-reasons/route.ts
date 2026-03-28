import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

// GET - List void reasons
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

    const voidReasons = await db.voidReason.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    })

    return ok({ voidReasons })
  } catch (error) {
    console.error('Void reasons list error:', error)
    return err('Failed to fetch void reasons', 500)
  }
})

// POST - Create void reason
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      description,
      deductInventory,
      requiresManager,
      sortOrder,
    } = body

    if (!locationId || !name) {
      return err('Location ID and name required')
    }

    // Get max sort order if not provided
    let order = sortOrder
    if (order === undefined) {
      const maxOrder = await db.voidReason.findFirst({
        where: { locationId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      })
      order = (maxOrder?.sortOrder ?? 0) + 1
    }

    const voidReason = await db.voidReason.create({
      data: {
        locationId,
        name,
        description,
        deductInventory: deductInventory ?? false,
        requiresManager: requiresManager ?? false,
        sortOrder: order,
      },
    })

    void notifyDataChanged({ locationId, domain: 'reasons', action: 'created', entityId: voidReason.id })
    void pushUpstream()

    return ok({ voidReason })
  } catch (error) {
    console.error('Create void reason error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('Void reason with this name already exists')
    }
    return err('Failed to create void reason', 500)
  }
}))
