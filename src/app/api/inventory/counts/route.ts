import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, ok } from '@/lib/api-response'

// GET - List inventory counts
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status') // pending, in_progress, completed

    if (!locationId) {
      return err('Location ID required')
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (status) where.status = status

    const counts = await db.inventoryCount.findMany({
      where,
      include: {
        storageLocation: {
          select: { id: true, name: true },
        },
        completedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        _count: {
          select: { items: true, entries: true },
        },
      },
      orderBy: { countDate: 'desc' },
    })

    return ok({
      counts: counts.map(count => ({
        ...count,
        totalVarianceCost: count.totalVarianceCost ? Number(count.totalVarianceCost) : null,
        varianceValue: count.varianceValue ? Number(count.varianceValue) : null,
        expectedValue: count.expectedValue ? Number(count.expectedValue) : null,
        countedValue: count.countedValue ? Number(count.countedValue) : null,
      })),
    })
  } catch (error) {
    console.error('Inventory counts list error:', error)
    return err('Failed to fetch inventory counts', 500)
  }
})

// POST - Create new inventory count
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      startedById,
      countType,
      storageLocationId,
      categoryFilter,
      notes,
    } = body

    if (!locationId || !startedById || !countType) {
      return err('Location ID, started by, and count type required')
    }

    // Auth check — require inventory.counts permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? startedById
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.INVENTORY_COUNTS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Only allow one in_progress count at a time
    const activeCount = await db.inventoryCount.findFirst({
      where: {
        locationId,
        status: 'in_progress',
        deletedAt: null,
      },
    })

    if (activeCount) {
      return err('An inventory count is already in progress. Complete or void it before starting a new one.', 409)
    }

    // Build the where clause for items to count
    const itemWhere: Record<string, unknown> = {
      locationId,
      trackInventory: true,
      isActive: true,
      deletedAt: null,
    }

    // Category filter for category-type counts
    if (categoryFilter && countType === 'category') {
      itemWhere.category = categoryFilter
    }

    // If storage location specified, only get items in that location
    let itemIds: string[] = []
    if (storageLocationId) {
      const storageItems = await db.inventoryItemStorage.findMany({
        where: { storageLocationId },
        select: { inventoryItemId: true },
      })
      itemIds = storageItems.map(si => si.inventoryItemId)
      if (itemIds.length === 0) {
        return err('No items found in specified storage location')
      }
      itemWhere.id = { in: itemIds }
    }

    // Get all items to count
    const items = await db.inventoryItem.findMany({
      where: itemWhere,
      select: {
        id: true,
        currentStock: true,
        costPerUnit: true,
        storageUnit: true,
      },
    })

    if (items.length === 0) {
      return err('No items to count')
    }

    // Create count with all items + COGS-style entries
    const count = await db.inventoryCount.create({
      data: {
        locationId,
        startedById,
        countType,
        storageLocationId,
        categoryFilter: categoryFilter || null,
        notes,
        countDate: new Date(),
        status: 'in_progress',
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
        items: {
          create: items.map(item => ({
            locationId,
            inventoryItemId: item.id,
            expectedQty: item.currentStock,
            lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
          })),
        },
        entries: countType !== 'spot' ? {
          create: items.map(item => ({
            locationId,
            inventoryItemId: item.id,
            expectedQty: item.currentStock,
            countedQty: 0,
            unit: item.storageUnit,
            unitCost: item.costPerUnit,
          })),
        } : undefined,
      },
      include: {
        storageLocation: {
          select: { id: true, name: true },
        },
        _count: {
          select: { items: true },
        },
      },
    })

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'created', entityId: count.id })
    void pushUpstream()

    return ok({ count })
  } catch (error) {
    console.error('Create inventory count error:', error)
    return err('Failed to create inventory count', 500)
  }
}))
