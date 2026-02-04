import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET - Get a single daily count session with all items
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const count = await db.dailyPrepCount.findUnique({
      where: { id },
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
              include: {
                trayConfigs: {
                  where: { deletedAt: null, isActive: true },
                  orderBy: { sortOrder: 'asc' },
                },
              },
            },
          },
        },
        transactions: {
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!count || count.deletedAt) {
      return NextResponse.json({ error: 'Daily count not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        ...count,
        countItems: count.countItems.map(item => ({
          ...item,
          totalCounted: Number(item.totalCounted),
          expectedQuantity: item.expectedQuantity ? Number(item.expectedQuantity) : null,
          variance: item.variance ? Number(item.variance) : null,
          variancePercent: item.variancePercent ? Number(item.variancePercent) : null,
          costPerUnit: item.costPerUnit ? Number(item.costPerUnit) : null,
          totalCost: item.totalCost ? Number(item.totalCost) : null,
          // Map ingredient to prepItem for frontend compatibility
          prepItem: {
            id: item.ingredient.id,
            name: item.ingredient.name,
            outputUnit: item.ingredient.standardUnit || 'each',
            batchYield: item.ingredient.batchYield ? Number(item.ingredient.batchYield) : 1,
            costPerUnit: null, // Would need calculation from parent
            currentPrepStock: Number(item.ingredient.currentPrepStock),
            trayConfigs: item.ingredient.trayConfigs.map(c => ({
              ...c,
              capacity: Number(c.capacity),
            })),
          },
        })),
        transactions: count.transactions.map(t => ({
          ...t,
          quantityBefore: Number(t.quantityBefore),
          quantityChange: Number(t.quantityChange),
          quantityAfter: Number(t.quantityAfter),
          unitCost: t.unitCost ? Number(t.unitCost) : null,
          totalCost: t.totalCost ? Number(t.totalCost) : null,
        })),
      },
    })
  } catch (error) {
    console.error('Get daily count error:', error)
    return NextResponse.json({ error: 'Failed to fetch daily count' }, { status: 500 })
  }
}

// PUT - Update count session or add/update count items
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { notes, countItems } = body

    const existing = await db.dailyPrepCount.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Daily count not found' }, { status: 404 })
    }

    if (existing.status !== 'draft') {
      return NextResponse.json({ error: 'Can only update draft counts' }, { status: 400 })
    }

    // Update notes if provided
    if (notes !== undefined) {
      await db.dailyPrepCount.update({
        where: { id },
        data: { notes },
      })
    }

    // Update or create count items
    if (countItems && Array.isArray(countItems)) {
      for (const item of countItems) {
        const { prepItemId, trayBreakdown, totalCounted, notes: itemNotes } = item

        if (!prepItemId || totalCounted === undefined) {
          continue
        }

        // Get ingredient (prep-style) for expected quantity and cost
        const ingredient = await db.ingredient.findUnique({
          where: { id: prepItemId },
          select: { currentPrepStock: true },
        })

        const expectedQty = ingredient ? Number(ingredient.currentPrepStock) : 0
        const variance = Number(totalCounted) - expectedQty
        const variancePct = expectedQty > 0 ? (variance / expectedQty) * 100 : 0
        // Cost would need to be calculated from parent ingredient - setting to null for now
        const costPerUnit = null
        const totalCost = null

        // Upsert the count item
        await db.dailyPrepCountItem.upsert({
          where: {
            dailyCountId_prepItemId: {
              dailyCountId: id,
              prepItemId,
            },
          },
          create: {
            locationId: existing.locationId,
            dailyCountId: id,
            prepItemId,
            trayBreakdown: trayBreakdown || {},
            totalCounted: Number(totalCounted),
            expectedQuantity: expectedQty,
            variance,
            variancePercent: variancePct,
            costPerUnit,
            totalCost,
            notes: itemNotes,
          },
          update: {
            trayBreakdown: trayBreakdown || {},
            totalCounted: Number(totalCounted),
            expectedQuantity: expectedQty,
            variance,
            variancePercent: variancePct,
            costPerUnit,
            totalCost,
            notes: itemNotes,
          },
        })
      }
    }

    // Fetch and return updated count
    const updatedCount = await db.dailyPrepCount.findUnique({
      where: { id },
      include: {
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
        ...updatedCount,
        countItems: updatedCount?.countItems.map(item => ({
          ...item,
          totalCounted: Number(item.totalCounted),
          expectedQuantity: item.expectedQuantity ? Number(item.expectedQuantity) : null,
          variance: item.variance ? Number(item.variance) : null,
          variancePercent: item.variancePercent ? Number(item.variancePercent) : null,
        })),
      },
    })
  } catch (error) {
    console.error('Update daily count error:', error)
    return NextResponse.json({ error: 'Failed to update daily count' }, { status: 500 })
  }
}

// DELETE - Soft delete a daily count session
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const existing = await db.dailyPrepCount.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Daily count not found' }, { status: 404 })
    }

    if (existing.status === 'approved') {
      return NextResponse.json({ error: 'Cannot delete approved counts' }, { status: 400 })
    }

    await db.dailyPrepCount.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { message: 'Daily count deleted' } })
  } catch (error) {
    console.error('Delete daily count error:', error)
    return NextResponse.json({ error: 'Failed to delete daily count' }, { status: 500 })
  }
}
