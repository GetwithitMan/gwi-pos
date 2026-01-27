import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
      where: { locationId },
      include: {
        tables: {
          where: { isActive: true },
          select: { id: true },
        },
        assignments: {
          where: { unassignedAt: null },
          include: {
            employee: {
              select: { id: true, displayName: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      sections: sections.map(section => ({
        id: section.id,
        name: section.name,
        color: section.color,
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
    const { locationId, name, color } = body

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'Location ID and name are required' },
        { status: 400 }
      )
    }

    const section = await db.section.create({
      data: {
        locationId,
        name,
        color: color || '#3B82F6',
      },
    })

    return NextResponse.json({
      section: {
        id: section.id,
        name: section.name,
        color: section.color,
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
