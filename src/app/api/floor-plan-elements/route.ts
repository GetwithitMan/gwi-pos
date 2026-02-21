import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { logger } from '@/lib/logger'
import { withVenue } from '@/lib/with-venue'

// GET - List all floor plan elements for a location (optionally filtered by section)
export const GET = withVenue(async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const locationId = searchParams.get('locationId')
  const sectionId = searchParams.get('sectionId')

  if (!locationId) {
    return NextResponse.json({ error: 'locationId required' }, { status: 400 })
  }

  try {
    const elements = await db.floorPlanElement.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(sectionId && { sectionId }),
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
        waitlistEntries: {
          where: { status: 'waiting', deletedAt: null },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            customerName: true,
            partySize: true,
            requestedAt: true,
            tableId: true,
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({ data: {
      elements: elements.map((el) => ({
        id: el.id,
        name: el.name,
        abbreviation: el.abbreviation,
        elementType: el.elementType,
        visualType: el.visualType,
        linkedMenuItemId: el.linkedMenuItemId,
        linkedMenuItem: el.linkedMenuItem,
        sectionId: el.sectionId,
        section: el.section,
        posX: el.posX,
        posY: el.posY,
        width: el.width,
        height: el.height,
        rotation: el.rotation,
        geometry: el.geometry,
        thickness: el.thickness,
        fillColor: el.fillColor,
        strokeColor: el.strokeColor,
        opacity: el.opacity,
        status: el.status,
        currentOrderId: el.currentOrderId,
        sessionStartedAt: el.sessionStartedAt,
        sessionExpiresAt: el.sessionExpiresAt,
        isLocked: el.isLocked,
        isVisible: el.isVisible,
        waitlistCount: el.waitlistEntries.length,
        waitlistEntries: el.waitlistEntries,
      })),
    } })
  } catch (error) {
    console.error('[floor-plan-elements] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch elements' }, { status: 500 })
  }
})

// POST - Create a new floor plan element
export const POST = withVenue(async function POST(req: Request) {
  try {
    const body = await req.json()
    logger.log('[floor-plan-elements] POST body:', body)

    const {
      locationId,
      sectionId,
      name,
      abbreviation,
      elementType = 'entertainment',
      visualType,
      linkedMenuItemId,
      posX,
      posY,
      width,
      height,
      rotation = 0,
      geometry,
      thickness = 0.5,
      fillColor,
      strokeColor,
      opacity = 1.0,
    } = body

    if (!locationId || !name || !visualType) {
      return NextResponse.json(
        { error: `Missing required fields: ${!locationId ? 'locationId ' : ''}${!name ? 'name ' : ''}${!visualType ? 'visualType' : ''}` },
        { status: 400 }
      )
    }

    // Verify linkedMenuItemId exists if provided (must not be soft-deleted)
    if (linkedMenuItemId) {
      const menuItem = await db.menuItem.findFirst({
        where: { id: linkedMenuItemId, deletedAt: null },
        select: { id: true },
      })
      if (!menuItem) {
        return NextResponse.json(
          { error: `Menu item not found: ${linkedMenuItemId}` },
          { status: 400 }
        )
      }
    }

    // Verify sectionId exists if provided (must not be soft-deleted)
    if (sectionId) {
      const section = await db.section.findFirst({
        where: { id: sectionId, deletedAt: null },
        select: { id: true },
      })
      if (!section) {
        return NextResponse.json(
          { error: `Section not found: ${sectionId}` },
          { status: 400 }
        )
      }
    }

    // Get highest sortOrder to place new element at end
    const lastElement = await db.floorPlanElement.findFirst({
      where: { locationId, deletedAt: null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    // Deterministic grid placement when position not specified
    let elementPosX = posX
    let elementPosY = posY

    if (posX === undefined || posY === undefined) {
      // Count existing elements in this section/location for grid positioning
      const existingElementsCount = await db.floorPlanElement.count({
        where: {
          locationId,
          sectionId: sectionId || null,
          deletedAt: null,
        },
      })

      // Auto-grid layout: 3 columns, offset from tables area
      const GRID_COLS = 3
      const GRID_SPACING = 150
      const GRID_START_X = 400 // Offset from tables to avoid overlap
      const GRID_START_Y = 50

      const col = existingElementsCount % GRID_COLS
      const row = Math.floor(existingElementsCount / GRID_COLS)

      elementPosX = posX ?? (GRID_START_X + col * GRID_SPACING)
      elementPosY = posY ?? (GRID_START_Y + row * GRID_SPACING)
    }

    logger.log('[floor-plan-elements] Creating element...')

    const element = await db.floorPlanElement.create({
      data: {
        locationId,
        sectionId: sectionId || null,
        name,
        abbreviation,
        elementType,
        visualType,
        linkedMenuItemId: linkedMenuItemId || null,
        posX: elementPosX,
        posY: elementPosY,
        width: width || 100,
        height: height || 100,
        rotation,
        geometry: geometry || null,
        thickness,
        fillColor,
        strokeColor,
        opacity,
        sortOrder: (lastElement?.sortOrder ?? -1) + 1,
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

    logger.log('[floor-plan-elements] Created element:', element.id)

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(locationId, { async: true })

    return NextResponse.json({ data: { element } })
  } catch (error) {
    console.error('[floor-plan-elements] POST error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Failed to create element: ${message}` }, { status: 500 })
  }
})
