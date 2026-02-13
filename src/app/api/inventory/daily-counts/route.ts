import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List daily prep count sessions
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status') // 'draft', 'submitted', 'approved', 'rejected'
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limit = parseInt(searchParams.get('limit') || '50')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (status) where.status = status

    if (startDate || endDate) {
      where.countDate = {}
      if (startDate) (where.countDate as Record<string, unknown>).gte = new Date(startDate)
      if (endDate) (where.countDate as Record<string, unknown>).lte = new Date(endDate)
    }

    const counts = await db.dailyPrepCount.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        submittedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        approvedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        countItems: {
          include: {
            ingredient: {
              select: { id: true, name: true, standardUnit: true },
            },
          },
        },
      },
      orderBy: { countDate: 'desc' },
      take: limit,
    })

    return NextResponse.json({
      data: counts.map(count => ({
        ...count,
        countItems: count.countItems.map(item => ({
          ...item,
          totalCounted: Number(item.totalCounted),
          expectedQuantity: item.expectedQuantity ? Number(item.expectedQuantity) : null,
          variance: item.variance ? Number(item.variance) : null,
          variancePercent: item.variancePercent ? Number(item.variancePercent) : null,
          costPerUnit: item.costPerUnit ? Number(item.costPerUnit) : null,
          totalCost: item.totalCost ? Number(item.totalCost) : null,
        })),
      })),
    })
  } catch (error) {
    console.error('Daily counts list error:', error)
    return NextResponse.json({ error: 'Failed to fetch daily counts' }, { status: 500 })
  }
})

// POST - Create a new daily prep count session
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      createdById,
      countDate,
      notes,
    } = body

    if (!locationId || !createdById) {
      return NextResponse.json({
        error: 'Location ID and created by ID required',
      }, { status: 400 })
    }

    // Check if there's already a count for today
    const today = countDate ? new Date(countDate) : new Date()
    const startOfDay = new Date(today)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(today)
    endOfDay.setHours(23, 59, 59, 999)

    const existingCount = await db.dailyPrepCount.findFirst({
      where: {
        locationId,
        countDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
        deletedAt: null,
        status: { not: 'rejected' },
      },
    })

    if (existingCount) {
      return NextResponse.json({
        error: 'A count session already exists for today',
        existingId: existingCount.id,
      }, { status: 400 })
    }

    // Create the count session
    const count = await db.dailyPrepCount.create({
      data: {
        locationId,
        createdById,
        countDate: today,
        status: 'draft',
        notes,
      },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    })

    return NextResponse.json({ data: count })
  } catch (error) {
    console.error('Create daily count error:', error)
    return NextResponse.json({ error: 'Failed to create daily count' }, { status: 500 })
  }
})
