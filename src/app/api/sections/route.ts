import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

// GET - List all sections for a location
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const sections = await db.section.findMany({
      where: { locationId, deletedAt: null },
      include: {
        tables: {
          where: { isActive: true, deletedAt: null },
          select: { id: true },
        },
        assignments: {
          where: { unassignedAt: null, deletedAt: null },
          include: {
            employee: {
              select: { id: true, displayName: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      sections: sections.map(section => ({
        id: section.id,
        name: section.name,
        color: section.color,
        sortOrder: section.sortOrder,
        posX: section.posX,
        posY: section.posY,
        width: section.width,
        height: section.height,
        widthFeet: section.widthFeet,
        heightFeet: section.heightFeet,
        gridSizeFeet: section.gridSizeFeet,
        tableCount: section.tables.length,
        assignedEmployees: section.assignments.map(a => ({
          id: a.employee.id,
          name: a.employee.displayName ||
            `${a.employee.firstName} ${a.employee.lastName}`,
        })),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch sections:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sections' },
      { status: 500 }
    )
  }
}

// POST - Create a new section
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, name, color, widthFeet, heightFeet, gridSizeFeet } = body

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'Location ID and name are required' },
        { status: 400 }
      )
    }

    // Get highest sortOrder to place new section at end
    const lastSection = await db.section.findFirst({
      where: { locationId, deletedAt: null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const newSortOrder = (lastSection?.sortOrder ?? -1) + 1

    const section = await db.section.create({
      data: {
        locationId,
        name,
        color: color || '#6366f1',
        sortOrder: newSortOrder,
        widthFeet: widthFeet ?? 40,
        heightFeet: heightFeet ?? 30,
        gridSizeFeet: gridSizeFeet ?? 0.25,
      },
    })

    dispatchFloorPlanUpdate(locationId, { async: true })

    return NextResponse.json({
      section: {
        id: section.id,
        name: section.name,
        color: section.color,
        sortOrder: section.sortOrder,
        posX: section.posX,
        posY: section.posY,
        width: section.width,
        height: section.height,
        widthFeet: section.widthFeet,
        heightFeet: section.heightFeet,
        gridSizeFeet: section.gridSizeFeet,
        tableCount: 0,
        assignedEmployees: [],
      },
    })
  } catch (error) {
    console.error('Failed to create section:', error)
    return NextResponse.json(
      { error: 'Failed to create section' },
      { status: 500 }
    )
  }
}
