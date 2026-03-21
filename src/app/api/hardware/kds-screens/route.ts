import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { KDSDisplayModeSchema, KDSTransitionTimesSchema, KDSOrderBehaviorSchema, KDSOrderTypeFiltersSchema } from '@/lib/kds/types'
import { notifyDataChanged } from '@/lib/cloud-notify'

// GET all KDS screens for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
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
        sourceLinks: {
          where: { deletedAt: null },
          include: { targetScreen: { select: { id: true, name: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return NextResponse.json({ data: {
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
        deviceInfo: s.deviceInfo,
        // KDS Overhaul: new fields
        displayMode: s.displayMode,
        transitionTimes: s.transitionTimes,
        orderBehavior: s.orderBehavior,
        orderTypeFilters: s.orderTypeFilters,
        stationCount: s.stations.length,
        stations: s.stations.map((st) => ({
          id: st.id,
          stationId: st.stationId,
          sortOrder: st.sortOrder,
          station: st.station,
        })),
        sourceLinks: s.sourceLinks.map((sl) => ({
          id: sl.id,
          targetScreenId: sl.targetScreenId,
          targetScreenName: sl.targetScreen.name,
          linkType: sl.linkType,
          bumpAction: sl.bumpAction,
          resetStrikethroughsOnSend: sl.resetStrikethroughsOnSend,
          isActive: sl.isActive,
        })),
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch KDS screens:', error)
    return NextResponse.json({ error: 'Failed to fetch KDS screens' }, { status: 500 })
  }
})

// POST create a new KDS screen
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
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
      displayMode,
      transitionTimes,
      orderBehavior,
      orderTypeFilters,
      employeeId: bodyEmployeeId,
    } = body

    // Validate required fields
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Auth check — require settings.hardware permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

    // Validate JSON fields if provided
    if (displayMode !== undefined) {
      const r = KDSDisplayModeSchema.safeParse(displayMode)
      if (!r.success) return NextResponse.json({ error: 'Invalid displayMode' }, { status: 400 })
    }
    if (transitionTimes !== undefined && transitionTimes !== null) {
      const r = KDSTransitionTimesSchema.safeParse(transitionTimes)
      if (!r.success) return NextResponse.json({ error: 'Invalid transitionTimes' }, { status: 400 })
    }
    if (orderBehavior !== undefined && orderBehavior !== null) {
      const r = KDSOrderBehaviorSchema.safeParse(orderBehavior)
      if (!r.success) return NextResponse.json({ error: 'Invalid orderBehavior' }, { status: 400 })
    }
    if (orderTypeFilters !== undefined && orderTypeFilters !== null) {
      const r = KDSOrderTypeFiltersSchema.safeParse(orderTypeFilters)
      if (!r.success) return NextResponse.json({ error: 'Invalid orderTypeFilters' }, { status: 400 })
    }

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
        ...(displayMode !== undefined && { displayMode }),
        ...(transitionTimes !== undefined && { transitionTimes: transitionTimes ?? undefined }),
        ...(orderBehavior !== undefined && { orderBehavior: orderBehavior ?? undefined }),
        ...(orderTypeFilters !== undefined && { orderTypeFilters: orderTypeFilters ?? undefined }),
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

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'created', entityId: screen.id })

    return NextResponse.json({ data: { screen: completeScreen } })
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
})
