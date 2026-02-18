import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

// GET - Get a single floor plan element
export const GET = withVenue(async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const { searchParams } = new URL(req.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const element = await db.floorPlanElement.findFirst({
      where: { id, locationId, deletedAt: null },
      include: {
        linkedMenuItem: {
          select: {
            id: true,
            name: true,
            price: true,
            itemType: true,
            entertainmentStatus: true,
            blockTimeMinutes: true,
            currentOrderId: true,
          },
        },
        section: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        waitlistEntries: {
          where: { status: 'waiting', deletedAt: null },
          orderBy: { position: 'asc' },
          include: {
            table: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    })

    if (!element) {
      return NextResponse.json({ error: 'Element not found' }, { status: 404 })
    }

    return NextResponse.json({ data: { element } })
  } catch (error) {
    console.error('[floor-plan-elements/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch element' }, { status: 500 })
  }
})

// PUT - Update a floor plan element
export const PUT = withVenue(async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const body = await req.json()
    const {
      locationId,
      name,
      abbreviation,
      sectionId,
      visualType,
      linkedMenuItemId,
      posX,
      posY,
      width,
      height,
      rotation,
      geometry,
      thickness,
      fillColor,
      strokeColor,
      opacity,
      status,
      currentOrderId,
      sessionStartedAt,
      sessionExpiresAt,
      isLocked,
      isVisible,
    } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Verify the element belongs to this location
    const existing = await db.floorPlanElement.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Element not found or access denied' }, { status: 404 })
    }

    const element = await db.floorPlanElement.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(abbreviation !== undefined && { abbreviation }),
        ...(sectionId !== undefined && { sectionId: sectionId || null }),
        ...(visualType !== undefined && { visualType }),
        ...(linkedMenuItemId !== undefined && { linkedMenuItemId: linkedMenuItemId || null }),
        ...(posX !== undefined && { posX }),
        ...(posY !== undefined && { posY }),
        ...(width !== undefined && { width }),
        ...(height !== undefined && { height }),
        ...(rotation !== undefined && { rotation }),
        ...(geometry !== undefined && { geometry }),
        ...(thickness !== undefined && { thickness }),
        ...(fillColor !== undefined && { fillColor }),
        ...(strokeColor !== undefined && { strokeColor }),
        ...(opacity !== undefined && { opacity }),
        ...(status !== undefined && { status }),
        ...(currentOrderId !== undefined && { currentOrderId }),
        ...(sessionStartedAt !== undefined && { sessionStartedAt: sessionStartedAt ? new Date(sessionStartedAt) : null }),
        ...(sessionExpiresAt !== undefined && { sessionExpiresAt: sessionExpiresAt ? new Date(sessionExpiresAt) : null }),
        ...(isLocked !== undefined && { isLocked }),
        ...(isVisible !== undefined && { isVisible }),
      },
      include: {
        linkedMenuItem: {
          select: {
            id: true,
            name: true,
            price: true,
            itemType: true,
            entertainmentStatus: true,
            blockTimeMinutes: true,
          },
        },
        section: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
    })

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(element.locationId, { async: true })

    return NextResponse.json({ data: { element } })
  } catch (error) {
    console.error('[floor-plan-elements/[id]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update element' }, { status: 500 })
  }
})

// DELETE - Soft delete a floor plan element
export const DELETE = withVenue(async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const { searchParams } = new URL(req.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Verify the element belongs to this location
    const existing = await db.floorPlanElement.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Element not found or access denied' }, { status: 404 })
    }

    const element = await db.floorPlanElement.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { locationId: true },
    })

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(element.locationId, { async: true })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[floor-plan-elements/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete element' }, { status: 500 })
  }
})
