import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

// POST - Submit a daily count for approval
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { submittedById } = body

    if (!submittedById) {
      return NextResponse.json({ error: 'Submitted by ID required' }, { status: 400 })
    }

    const existing = await db.dailyPrepCount.findUnique({
      where: { id },
      include: {
        countItems: true,
      },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Daily count not found' }, { status: 404 })
    }

    if (existing.status !== 'draft') {
      return NextResponse.json({ error: 'Can only submit draft counts' }, { status: 400 })
    }

    if (existing.countItems.length === 0) {
      return NextResponse.json({ error: 'Cannot submit a count with no items' }, { status: 400 })
    }

    const count = await db.dailyPrepCount.update({
      where: { id },
      data: {
        status: 'submitted',
        submittedById,
        submittedAt: new Date(),
      },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        submittedBy: {
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
    })

    return NextResponse.json({
      data: {
        ...count,
        countItems: count.countItems.map(item => ({
          ...item,
          totalCounted: Number(item.totalCounted),
          expectedQuantity: item.expectedQuantity ? Number(item.expectedQuantity) : null,
          variance: item.variance ? Number(item.variance) : null,
          variancePercent: item.variancePercent ? Number(item.variancePercent) : null,
        })),
      },
    })
  } catch (error) {
    console.error('Submit daily count error:', error)
    return NextResponse.json({ error: 'Failed to submit daily count' }, { status: 500 })
  }
}
