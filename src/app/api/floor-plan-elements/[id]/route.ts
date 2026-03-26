import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET - Get a single floor plan element
export const GET = withVenue(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const { searchParams } = new URL(req.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Allow device-authenticated requests (KDS/CFD via cellular proxy or device token)
    const isCellularDevice = req.headers.get('x-cellular-authenticated') === 'true'
    if (!isCellularDevice) {
      const actor = await getActorFromRequest(req)
      const employeeId = searchParams.get('employeeId') ?? actor.employeeId
      const authCheck = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
      if (!authCheck.authorized) {
        return NextResponse.json({ error: authCheck.error }, { status: authCheck.status })
      }
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
        ...(posX !== undefined && { posX: Math.round(Number(posX)) }),
        ...(posY !== undefined && { posY: Math.round(Number(posY)) }),
        ...(width !== undefined && { width: Math.round(Number(width)) }),
        ...(height !== undefined && { height: Math.round(Number(height)) }),
        ...(rotation !== undefined && { rotation: Math.round(Number(rotation)) }),
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

    void notifyDataChanged({ locationId: element.locationId, domain: 'floorplan', action: 'updated', entityId: id })
    void pushUpstream()

    return NextResponse.json({ data: { element } })
  } catch (error) {
    console.error('[floor-plan-elements/[id]] PUT error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Failed to update element: ${message}` }, { status: 500 })
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

    void notifyDataChanged({ locationId: element.locationId, domain: 'floorplan', action: 'deleted', entityId: id })
    void pushUpstream()

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[floor-plan-elements/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete element' }, { status: 500 })
  }
})
