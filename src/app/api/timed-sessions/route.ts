import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Start a new timed session
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, menuItemId, tableId, rateType, rateAmount, startedById } = body

    if (!locationId || !menuItemId || !rateType || rateAmount === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const session = await db.timedSession.create({
      data: {
        locationId,
        menuItemId,
        tableId: tableId || null,
        rateType,
        rateAmount,
        startedById: startedById || null,
        status: 'active',
      },
    })

    // Mark the entertainment item as in_use
    await db.menuItem.update({
      where: { id: menuItemId },
      data: {
        entertainmentStatus: 'in_use',
        currentOrderId: session.id, // Use session ID as reference
      },
    })

    return NextResponse.json(session)
  } catch (error) {
    console.error('Failed to create timed session:', error)
    return NextResponse.json(
      { error: 'Failed to create timed session' },
      { status: 500 }
    )
  }
})

// GET - List active sessions for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status') || 'active'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Missing locationId' },
        { status: 400 }
      )
    }

    const sessions = await db.timedSession.findMany({
      where: {
        locationId,
        status,
      },
      include: {
        table: {
          select: { id: true, name: true },
        },
      },
      orderBy: { startedAt: 'desc' },
    })

    // Fetch menu item info for each session
    const menuItemIds = [...new Set(sessions.map(s => s.menuItemId))]
    const menuItems = await db.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      select: { id: true, name: true },
    })
    const menuItemMap = Object.fromEntries(menuItems.map(m => [m.id, m.name]))

    return NextResponse.json({
      sessions: sessions.map(s => ({
        id: s.id,
        menuItemId: s.menuItemId,
        menuItemName: menuItemMap[s.menuItemId] || 'Unknown',
        tableId: s.tableId,
        tableName: s.table?.name,
        startedAt: s.startedAt,
        rateType: s.rateType,
        rateAmount: Number(s.rateAmount),
        status: s.status,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch timed sessions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch timed sessions' },
      { status: 500 }
    )
  }
})
