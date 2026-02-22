import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

/**
 * PUT /api/liquor/bottles/reorder
 * Reorder bottles within a spirit category by updating sortOrder
 */
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { bottleIds } = body

    if (!bottleIds || !Array.isArray(bottleIds)) {
      return NextResponse.json(
        { error: 'bottleIds array is required' },
        { status: 400 }
      )
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify all bottles belong to this location
    const bottles = await db.bottleProduct.findMany({
      where: {
        id: { in: bottleIds },
        locationId,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (bottles.length !== bottleIds.length) {
      return NextResponse.json(
        { error: 'One or more bottles not found' },
        { status: 404 }
      )
    }

    // Update sortOrder for each bottle
    await db.$transaction(
      bottleIds.map((id: string, index: number) =>
        db.bottleProduct.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    )

    // Real-time cross-terminal update
    void dispatchMenuUpdate(locationId, {
      action: 'updated',
      name: 'bottles-reorder',
    }).catch(() => {})

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to reorder bottles:', error)
    return NextResponse.json(
      { error: 'Failed to reorder bottles' },
      { status: 500 }
    )
  }
})
