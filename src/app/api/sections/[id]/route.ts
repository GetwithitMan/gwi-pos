import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { softDeleteData } from '@/lib/floorplan/queries'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

// GET - Get a single section
export async function GET(
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

    const section = await db.section.findFirst({
      where: { id, locationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        color: true,
        posX: true,
        posY: true,
        width: true,
        height: true,
        widthFeet: true,
        heightFeet: true,
        gridSizeFeet: true,
        sortOrder: true,
        isVisible: true,
      },
    })

    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    return NextResponse.json({ section })
  } catch (error) {
    console.error('[sections/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch section' }, { status: 500 })
  }
}

// PUT - Update a section
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const body = await req.json()
    const { locationId, name, color, isVisible, posX, posY, width, height, widthFeet, heightFeet, gridSizeFeet } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Verify the section belongs to this location
    const existing = await db.section.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Section not found or access denied' }, { status: 404 })
    }

    const section = await db.section.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(color !== undefined && { color }),
        ...(isVisible !== undefined && { isVisible }),
        ...(posX !== undefined && { posX }),
        ...(posY !== undefined && { posY }),
        ...(width !== undefined && { width }),
        ...(height !== undefined && { height }),
        ...(widthFeet !== undefined && { widthFeet }),
        ...(heightFeet !== undefined && { heightFeet }),
        ...(gridSizeFeet !== undefined && { gridSizeFeet }),
      },
      select: {
        id: true,
        name: true,
        color: true,
        posX: true,
        posY: true,
        width: true,
        height: true,
        widthFeet: true,
        heightFeet: true,
        gridSizeFeet: true,
        sortOrder: true,
        isVisible: true,
      },
    })

    dispatchFloorPlanUpdate(locationId, { async: true })

    return NextResponse.json({ section })
  } catch (error) {
    console.error('[sections/[id]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update section' }, { status: 500 })
  }
}

// DELETE - Soft delete a section (and optionally its tables)
export async function DELETE(
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

    // Verify the section belongs to this location
    const existing = await db.section.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Section not found or access denied' }, { status: 404 })
    }

    // Check if section has tables
    const tablesInSection = await db.table.count({
      where: { sectionId: id, locationId, deletedAt: null },
    })

    if (tablesInSection > 0) {
      // Move tables to no section instead of deleting them
      await db.table.updateMany({
        where: { sectionId: id, locationId, deletedAt: null },
        data: { sectionId: null },
      })
    }

    // Soft delete the section
    await db.section.update({
      where: { id },
      data: softDeleteData(),
    })

    dispatchFloorPlanUpdate(locationId, { async: true })

    return NextResponse.json({ success: true, tablesMovedToNoSection: tablesInSection })
  } catch (error) {
    console.error('[sections/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete section' }, { status: 500 })
  }
}
