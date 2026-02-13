import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List storage locations
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const activeOnly = searchParams.get('activeOnly') !== 'false'

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
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

    return NextResponse.json({ storageLocations })
  } catch (error) {
    console.error('Storage locations list error:', error)
    return NextResponse.json({ error: 'Failed to fetch storage locations' }, { status: 500 })
  }
})

// POST - Create storage location
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, name, description, sortOrder } = body

    if (!locationId || !name) {
      return NextResponse.json({
        error: 'Location ID and name required',
      }, { status: 400 })
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

    return NextResponse.json({ storageLocation })
  } catch (error) {
    console.error('Create storage location error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Storage location with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create storage location' }, { status: 500 })
  }
})
