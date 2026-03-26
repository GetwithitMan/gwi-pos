import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { KDSDisplayModeSchema, KDSTransitionTimesSchema, KDSOrderBehaviorSchema, KDSOrderTypeFiltersSchema } from '@/lib/kds/types'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'

// GET single KDS screen
export const GET = withVenue(withAuth('ADMIN', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const screen = await db.kDSScreen.findUnique({
      where: { id },
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

    if (!screen) {
      return NextResponse.json({ error: 'KDS screen not found' }, { status: 404 })
    }

    return NextResponse.json({ data: { screen } })
  } catch (error) {
    console.error('Failed to fetch KDS screen:', error)
    return NextResponse.json({ error: 'Failed to fetch KDS screen' }, { status: 500 })
  }
}))

// PUT update KDS screen
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existingScreen = await db.kDSScreen.findUnique({
      where: { id },
    })

    if (!existingScreen) {
      return NextResponse.json({ error: 'KDS screen not found' }, { status: 404 })
    }

    const {
      name,
      screenType,
      columns,
      fontSize,
      colorScheme,
      agingWarning,
      lateWarning,
      playSound,
      flashOnNew,
      isActive,
      sortOrder,
      stationIds,
      staticIp,
      enforceStaticIp,
      displayMode,
      transitionTimes,
      orderBehavior,
      orderTypeFilters,
    } = body

    // Validate new JSON fields if provided
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

    // Update the screen
    await db.kDSScreen.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(screenType !== undefined && { screenType }),
        ...(columns !== undefined && { columns }),
        ...(fontSize !== undefined && { fontSize }),
        ...(colorScheme !== undefined && { colorScheme }),
        ...(agingWarning !== undefined && { agingWarning }),
        ...(lateWarning !== undefined && { lateWarning }),
        ...(playSound !== undefined && { playSound }),
        ...(flashOnNew !== undefined && { flashOnNew }),
        ...(isActive !== undefined && { isActive }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(staticIp !== undefined && { staticIp: staticIp || null }),
        ...(enforceStaticIp !== undefined && { enforceStaticIp }),
        ...(displayMode !== undefined && { displayMode }),
        ...(transitionTimes !== undefined && { transitionTimes: transitionTimes ?? undefined }),
        ...(orderBehavior !== undefined && { orderBehavior: orderBehavior ?? undefined }),
        ...(orderTypeFilters !== undefined && { orderTypeFilters: orderTypeFilters ?? undefined }),
      },
    })

    // Update station assignments if provided
    if (stationIds !== undefined) {
      // Remove existing assignments
      await db.kDSScreenStation.deleteMany({
        where: { kdsScreenId: id },
      })

      // Create new assignments
      if (stationIds.length > 0) {
        await db.kDSScreenStation.createMany({
          data: stationIds.map((stationId: string, index: number) => ({
            kdsScreenId: id,
            stationId,
            sortOrder: index,
          })),
        })
      }
    }

    // Fetch the complete screen with stations
    const completeScreen = await db.kDSScreen.findUnique({
      where: { id },
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

    // Notify all terminals that KDS screen config changed
    void emitToLocation(existingScreen.locationId, 'settings:updated', { source: 'kds-screen', action: 'updated', screenId: id }).catch(console.error)
    void notifyDataChanged({ locationId: existingScreen.locationId, domain: 'hardware', action: 'updated', entityId: id })
    void pushUpstream()

    return NextResponse.json({ data: { screen: completeScreen } })
  } catch (error) {
    console.error('Failed to update KDS screen:', error)
    return NextResponse.json({ error: 'Failed to update KDS screen' }, { status: 500 })
  }
}))

// DELETE KDS screen
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check if screen exists
    const screen = await db.kDSScreen.findUnique({
      where: { id },
    })

    if (!screen) {
      return NextResponse.json({ error: 'KDS screen not found' }, { status: 404 })
    }

    // Soft delete the screen
    await db.kDSScreen.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    // Clean up orphaned screen links where this screen is source or target
    await db.kDSScreenLink.deleteMany({
      where: {
        OR: [
          { sourceScreenId: id },
          { targetScreenId: id },
        ],
      },
    })

    void notifyDataChanged({ locationId: screen.locationId, domain: 'hardware', action: 'deleted', entityId: id })
    void pushUpstream()

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete KDS screen:', error)
    return NextResponse.json({ error: 'Failed to delete KDS screen' }, { status: 500 })
  }
}))
