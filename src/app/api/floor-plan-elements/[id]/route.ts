import { db } from '@/lib/db'
import { NextRequest } from 'next/server'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

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
      return err('locationId is required')
    }

    // Allow device-authenticated requests (KDS/CFD via cellular proxy or device token)
    const isCellularDevice = req.headers.get('x-cellular-authenticated') === 'true'
    if (!isCellularDevice) {
      const actor = await getActorFromRequest(req)
      const employeeId = searchParams.get('employeeId') ?? actor.employeeId
      const authCheck = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
      if (!authCheck.authorized) {
        return err(authCheck.error, authCheck.status)
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
      return notFound('Element not found')
    }

    return ok({ element })
  } catch (error) {
    console.error('[floor-plan-elements/[id]] GET error:', error)
    return err('Failed to fetch element', 500)
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
      return err('locationId is required')
    }

    // Verify the element belongs to this location
    const existing = await db.floorPlanElement.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return notFound('Element not found or access denied')
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

    return ok({ element })
  } catch (error) {
    console.error('[floor-plan-elements/[id]] PUT error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return err(`Failed to update element: ${message}`, 500)
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
      return err('locationId is required')
    }

    // Verify the element belongs to this location
    const existing = await db.floorPlanElement.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return notFound('Element not found or access denied')
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

    return ok({ success: true })
  } catch (error) {
    console.error('[floor-plan-elements/[id]] DELETE error:', error)
    return err('Failed to delete element', 500)
  }
})
