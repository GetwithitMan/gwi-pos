import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET single KDS screen
export const GET = withVenue(async function GET(
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

    return NextResponse.json({ screen })
  } catch (error) {
    console.error('Failed to fetch KDS screen:', error)
    return NextResponse.json({ error: 'Failed to fetch KDS screen' }, { status: 500 })
  }
})

// PUT update KDS screen
export const PUT = withVenue(async function PUT(
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
    } = body

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

    return NextResponse.json({ screen: completeScreen })
  } catch (error) {
    console.error('Failed to update KDS screen:', error)
    return NextResponse.json({ error: 'Failed to update KDS screen' }, { status: 500 })
  }
})

// DELETE KDS screen
export const DELETE = withVenue(async function DELETE(
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

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete KDS screen:', error)
    return NextResponse.json({ error: 'Failed to delete KDS screen' }, { status: 500 })
  }
})
