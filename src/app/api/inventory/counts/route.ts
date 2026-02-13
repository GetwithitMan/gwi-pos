import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List inventory counts
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status') // pending, in_progress, completed

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
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
        _count: {
          select: { items: true },
        },
      },
      orderBy: { countDate: 'desc' },
    })

    return NextResponse.json({
      counts: counts.map(count => ({
        ...count,
        varianceValue: count.varianceValue ? Number(count.varianceValue) : null,
        expectedValue: count.expectedValue ? Number(count.expectedValue) : null,
        countedValue: count.countedValue ? Number(count.countedValue) : null,
      })),
    })
  } catch (error) {
    console.error('Inventory counts list error:', error)
    return NextResponse.json({ error: 'Failed to fetch inventory counts' }, { status: 500 })
  }
})

// POST - Create new inventory count
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      startedById,
      countType,
      storageLocationId,
      notes,
    } = body

    if (!locationId || !startedById || !countType) {
      return NextResponse.json({
        error: 'Location ID, started by, and count type required',
      }, { status: 400 })
    }

    // Build the where clause for items to count
    const itemWhere: Record<string, unknown> = {
      locationId,
      trackInventory: true,
      isActive: true,
      deletedAt: null,
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
        return NextResponse.json({
          error: 'No items found in specified storage location',
        }, { status: 400 })
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
      return NextResponse.json({
        error: 'No items to count',
      }, { status: 400 })
    }

    // Create count with all items
    const count = await db.inventoryCount.create({
      data: {
        locationId,
        startedById,
        countType,
        storageLocationId,
        notes,
        countDate: new Date(),
        status: 'in_progress',
        items: {
          create: items.map(item => ({
            locationId,
            inventoryItemId: item.id,
            expectedQty: item.currentStock,
          })),
        },
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

    return NextResponse.json({ count })
  } catch (error) {
    console.error('Create inventory count error:', error)
    return NextResponse.json({ error: 'Failed to create inventory count' }, { status: 500 })
  }
})
