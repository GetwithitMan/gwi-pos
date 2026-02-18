import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List void reasons
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const activeOnly = searchParams.get('activeOnly') !== 'false'

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (activeOnly) where.isActive = true

    const voidReasons = await db.voidReason.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({ data: { voidReasons } })
  } catch (error) {
    console.error('Void reasons list error:', error)
    return NextResponse.json({ error: 'Failed to fetch void reasons' }, { status: 500 })
  }
})

// POST - Create void reason
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      description,
      deductInventory,
      requiresManager,
      sortOrder,
    } = body

    if (!locationId || !name) {
      return NextResponse.json({
        error: 'Location ID and name required',
      }, { status: 400 })
    }

    // Get max sort order if not provided
    let order = sortOrder
    if (order === undefined) {
      const maxOrder = await db.voidReason.findFirst({
        where: { locationId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      })
      order = (maxOrder?.sortOrder ?? 0) + 1
    }

    const voidReason = await db.voidReason.create({
      data: {
        locationId,
        name,
        description,
        deductInventory: deductInventory ?? false,
        requiresManager: requiresManager ?? false,
        sortOrder: order,
      },
    })

    return NextResponse.json({ data: { voidReason } })
  } catch (error) {
    console.error('Create void reason error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Void reason with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create void reason' }, { status: 500 })
  }
})
