import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

// GET - List comp reasons
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

    const compReasons = await db.compReason.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    })

    return ok({ compReasons })
  } catch (error) {
    console.error('Comp reasons list error:', error)
    return err('Failed to fetch comp reasons', 500)
  }
})

// POST - Create comp reason
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
      const maxOrder = await db.compReason.findFirst({
        where: { locationId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      })
      order = (maxOrder?.sortOrder ?? 0) + 1
    }

    const compReason = await db.compReason.create({
      data: {
        locationId,
        name,
        description,
        deductInventory: deductInventory ?? false,
        requiresManager: requiresManager ?? false,
        sortOrder: order,
      },
    })

    void notifyDataChanged({ locationId, domain: 'reasons', action: 'created', entityId: compReason.id })
    void pushUpstream()

    return ok({ compReason })
  } catch (error) {
    console.error('Create comp reason error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('Comp reason with this name already exists')
    }
    return err('Failed to create comp reason', 500)
  }
}))
