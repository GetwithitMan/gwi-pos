import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List all prep stations for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const stations = await db.prepStation.findMany({
      where: { locationId },
      include: {
        _count: {
          select: {
            categories: true,
            menuItems: true,
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      stations: stations.map(station => ({
        id: station.id,
        name: station.name,
        displayName: station.displayName,
        color: station.color,
        stationType: station.stationType,
        sortOrder: station.sortOrder,
        isActive: station.isActive,
        showAllItems: station.showAllItems,
        autoComplete: station.autoComplete,
        categoryCount: station._count.categories,
        itemCount: station._count.menuItems,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch prep stations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch prep stations' },
      { status: 500 }
    )
  }
})

// POST - Create a new prep station
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, name, displayName, color, stationType, showAllItems, autoComplete } = body as {
      locationId: string
      name: string
      displayName?: string
      color?: string
      stationType?: string
      showAllItems?: boolean
      autoComplete?: number
    }

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'Location ID and name are required' },
        { status: 400 }
      )
    }

    // Check for duplicate name
    const existing = await db.prepStation.findFirst({
      where: {
        locationId,
        name: { equals: name },
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'A prep station with this name already exists' },
        { status: 409 }
      )
    }

    // Get max sort order
    const maxSort = await db.prepStation.findFirst({
      where: { locationId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const station = await db.prepStation.create({
      data: {
        locationId,
        name,
        displayName,
        color,
        stationType: stationType || 'kitchen',
        showAllItems: showAllItems || false,
        autoComplete,
        sortOrder: (maxSort?.sortOrder || 0) + 1,
      },
    })

    return NextResponse.json({
      id: station.id,
      name: station.name,
      displayName: station.displayName,
      color: station.color,
      stationType: station.stationType,
      isActive: station.isActive,
      showAllItems: station.showAllItems,
      autoComplete: station.autoComplete,
      sortOrder: station.sortOrder,
    })
  } catch (error) {
    console.error('Failed to create prep station:', error)
    return NextResponse.json(
      { error: 'Failed to create prep station' },
      { status: 500 }
    )
  }
})
