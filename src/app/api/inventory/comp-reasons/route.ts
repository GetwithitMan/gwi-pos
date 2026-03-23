import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { withAuth } from '@/lib/api-auth-middleware'

// GET - List comp reasons
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

    const compReasons = await db.compReason.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({ data: { compReasons } })
  } catch (error) {
    console.error('Comp reasons list error:', error)
    return NextResponse.json({ error: 'Failed to fetch comp reasons' }, { status: 500 })
  }
})

// POST - Create comp reason
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
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
      const maxOrder = await db.compReason.findFirst({
        where: { locationId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      })
      order = (maxOrder?.sortOrder ?? 0) + 1
    }

    const compReason = await db.compReason.create({
      data: {
        locationId,
        name,
        description,
        deductInventory: deductInventory ?? false,
        requiresManager: requiresManager ?? false,
        sortOrder: order,
      },
    })

    void notifyDataChanged({ locationId, domain: 'reasons', action: 'created', entityId: compReason.id })

    return NextResponse.json({ data: { compReason } })
  } catch (error) {
    console.error('Create comp reason error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Comp reason with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create comp reason' }, { status: 500 })
  }
}))
