import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const DEFAULT_LOCATION_ID = 'loc-1'

// GET all KDS screens for a location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId') || DEFAULT_LOCATION_ID
    const screenType = searchParams.get('screenType') // Filter by type

    const screens = await db.kDSScreen.findMany({
      where: {
        locationId,
        ...(screenType && { screenType }),
      },
      include: {
        stations: {
          include: {
            station: {
              select: {
                id: true,
                name: true,
                displayName: true,
                stationType: true,
                color: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return NextResponse.json({
      screens: screens.map((s) => ({
        id: s.id,
        locationId: s.locationId,
        name: s.name,
        slug: s.slug,
        screenType: s.screenType,
        columns: s.columns,
        fontSize: s.fontSize,
        colorScheme: s.colorScheme,
        agingWarning: s.agingWarning,
        lateWarning: s.lateWarning,
        playSound: s.playSound,
        flashOnNew: s.flashOnNew,
        isActive: s.isActive,
        lastSeenAt: s.lastSeenAt,
        isOnline: s.isOnline,
        sortOrder: s.sortOrder,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        isPaired: s.isPaired,
        lastKnownIp: s.lastKnownIp,
        staticIp: s.staticIp,
        enforceStaticIp: s.enforceStaticIp,
        stationCount: s.stations.length,
        stations: s.stations.map((st) => ({
          id: st.id,
          stationId: st.stationId,
          sortOrder: st.sortOrder,
          station: st.station,
        })),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch KDS screens:', error)
    return NextResponse.json({ error: 'Failed to fetch KDS screens' }, { status: 500 })
  }
}

// POST create a new KDS screen
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId = DEFAULT_LOCATION_ID,
      name,
      screenType = 'kds',
      columns = 4,
      fontSize = 'normal',
      colorScheme = 'dark',
      agingWarning = 8,
      lateWarning = 15,
      playSound = true,
      flashOnNew = true,
      stationIds = [],
      staticIp,
      enforceStaticIp = false,
    } = body

    // Validate required fields
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Generate slug from name
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    // Check for duplicate slug
    const existingSlug = await db.kDSScreen.findFirst({
      where: { locationId, slug: baseSlug },
    })
    const slug = existingSlug ? `${baseSlug}-${Date.now()}` : baseSlug

    // Create the screen
    const screen = await db.kDSScreen.create({
      data: {
        locationId,
        name,
        slug,
        screenType,
        columns,
        fontSize,
        colorScheme,
        agingWarning,
        lateWarning,
        playSound,
        flashOnNew,
        staticIp: staticIp || null,
        enforceStaticIp,
      },
    })

    // Link stations if provided
    if (stationIds.length > 0) {
      await db.kDSScreenStation.createMany({
        data: stationIds.map((stationId: string, index: number) => ({
          kdsScreenId: screen.id,
          stationId,
          sortOrder: index,
        })),
      })
    }

    // Fetch the complete screen with stations
    const completeScreen = await db.kDSScreen.findUnique({
      where: { id: screen.id },
      include: {
        stations: {
          include: {
            station: {
              select: {
                id: true,
                name: true,
                displayName: true,
                stationType: true,
                color: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    return NextResponse.json({ screen: completeScreen })
  } catch (error) {
    console.error('Failed to create KDS screen:', error)
    // Check for unique constraint violation
    if (error instanceof Error) {
      if (error.message.includes('Unique constraint')) {
        return NextResponse.json(
          { error: 'A KDS screen with this name already exists at this location' },
          { status: 400 }
        )
      }
      // Return detailed error for debugging
      return NextResponse.json({ error: `Failed to create KDS screen: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json({ error: 'Failed to create KDS screen' }, { status: 500 })
  }
}
