import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get a single timed session
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const session = await db.timedSession.findUnique({
      where: { id },
      include: {
        table: { select: { id: true, name: true } },
      },
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    // Get menu item name
    const menuItem = await db.menuItem.findUnique({
      where: { id: session.menuItemId },
      select: { name: true },
    })

    return NextResponse.json({ data: {
      ...session,
      menuItemName: menuItem?.name || 'Unknown',
      rateAmount: Number(session.rateAmount),
      totalCharge: session.totalCharge ? Number(session.totalCharge) : null,
    } })
  } catch (error) {
    console.error('Failed to fetch timed session:', error)
    return NextResponse.json(
      { error: 'Failed to fetch timed session' },
      { status: 500 }
    )
  }
})

// PUT - Stop/update a timed session
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action } = body

    const session = await db.timedSession.findUnique({
      where: { id },
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    if (action === 'stop') {
      // Calculate total time and charges
      const endedAt = new Date()
      const startedAt = new Date(session.startedAt)
      const elapsedMs = endedAt.getTime() - startedAt.getTime() - (session.pausedMinutes * 60000)
      const totalMinutes = Math.ceil(elapsedMs / 60000)

      // Calculate total charge based on rate type
      let totalCharge = 0
      const rateAmount = Number(session.rateAmount)

      switch (session.rateType) {
        case 'per15Min':
          totalCharge = Math.ceil(totalMinutes / 15) * rateAmount
          break
        case 'per30Min':
          totalCharge = Math.ceil(totalMinutes / 30) * rateAmount
          break
        case 'perHour':
        case 'hourly':
          totalCharge = Math.ceil(totalMinutes / 60) * rateAmount
          break
        default:
          // Default to per hour
          totalCharge = Math.ceil(totalMinutes / 60) * rateAmount
      }

      // Update session
      const updatedSession = await db.timedSession.update({
        where: { id },
        data: {
          endedAt,
          totalMinutes,
          totalCharge,
          status: 'completed',
        },
      })

      // Reset entertainment item status to available
      await db.menuItem.update({
        where: { id: session.menuItemId },
        data: {
          entertainmentStatus: 'available',
          currentOrderId: null,
          currentOrderItemId: null,
        },
      })

      return NextResponse.json({ data: {
        ...updatedSession,
        rateAmount: Number(updatedSession.rateAmount),
        totalCharge: Number(updatedSession.totalCharge),
        totalMinutes,
        totalAmount: totalCharge,
      } })
    }

    if (action === 'pause') {
      const updatedSession = await db.timedSession.update({
        where: { id },
        data: {
          pausedAt: new Date(),
          status: 'paused',
        },
      })

      return NextResponse.json({ data: {
        ...updatedSession,
        rateAmount: Number(updatedSession.rateAmount),
      } })
    }

    if (action === 'resume') {
      // Calculate paused time and add to total
      const pausedAt = session.pausedAt
      if (pausedAt) {
        const pausedMs = Date.now() - new Date(pausedAt).getTime()
        const additionalPausedMinutes = Math.floor(pausedMs / 60000)

        const updatedSession = await db.timedSession.update({
          where: { id },
          data: {
            pausedAt: null,
            pausedMinutes: session.pausedMinutes + additionalPausedMinutes,
            status: 'active',
          },
        })

        return NextResponse.json({ data: {
          ...updatedSession,
          rateAmount: Number(updatedSession.rateAmount),
        } })
      }
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Failed to update timed session:', error)
    return NextResponse.json(
      { error: 'Failed to update timed session' },
      { status: 500 }
    )
  }
})
