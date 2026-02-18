import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

interface RouteParams {
  params: Promise<{ id: string }>
}

// POST - Approve a daily count and update ingredient stock levels
export const POST = withVenue(async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { approvedById, reject, rejectionReason } = body

    if (!approvedById) {
      return NextResponse.json({ error: 'Approved by ID required' }, { status: 400 })
    }

    const existing = await db.dailyPrepCount.findUnique({
      where: { id },
      include: {
        countItems: {
          include: {
            ingredient: {
              include: {
                parentIngredient: {
                  include: {
                    inventoryItem: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Daily count not found' }, { status: 404 })
    }

    if (existing.status !== 'submitted') {
      return NextResponse.json({ error: 'Can only approve/reject submitted counts' }, { status: 400 })
    }

    // Handle rejection
    if (reject) {
      const count = await db.dailyPrepCount.update({
        where: { id },
        data: {
          status: 'rejected',
          approvedById,
          approvedAt: new Date(),
          rejectionReason: rejectionReason || 'Rejected by manager',
        },
      })

      return NextResponse.json({ data: count })
    }

    // Process approval - update ingredient stock levels
    const transactions: {
      type: string
      prepItemId?: string
      inventoryItemId?: string
      quantityBefore: number
      quantityChange: number
      quantityAfter: number
      unit?: string
      unitCost?: number
      totalCost?: number
    }[] = []

    const now = new Date()

    // Build transaction records and collect ingredient updates
    for (const countItem of existing.countItems) {
      const ingredient = countItem.ingredient
      const totalCounted = Number(countItem.totalCounted)
      const prepStockBefore = Number(ingredient.currentPrepStock)
      const prepStockAfter = totalCounted

      transactions.push({
        type: 'prep_stock_add',
        prepItemId: ingredient.id,
        quantityBefore: prepStockBefore,
        quantityChange: totalCounted - prepStockBefore,
        quantityAfter: prepStockAfter,
        unit: ingredient.standardUnit || 'each',
      })
    }

    // Batch: update all ingredient stocks in parallel
    await Promise.all(existing.countItems.map(countItem => {
      const totalCounted = Number(countItem.totalCounted)
      return db.ingredient.update({
        where: { id: countItem.ingredient.id },
        data: {
          currentPrepStock: totalCounted,
          lastCountedAt: now,
        },
      })
    }))

    // Batch: create all transaction records at once
    if (transactions.length > 0) {
      await db.dailyPrepCountTransaction.createMany({
        data: transactions.map(t => ({
          locationId: existing.locationId,
          dailyCountId: id,
          type: t.type,
          prepItemId: t.prepItemId,
          inventoryItemId: t.inventoryItemId,
          quantityBefore: t.quantityBefore,
          quantityChange: t.quantityChange,
          quantityAfter: t.quantityAfter,
          unit: t.unit,
          unitCost: t.unitCost,
          totalCost: t.totalCost,
        })),
      })
    }

    // Update count status
    const count = await db.dailyPrepCount.update({
      where: { id },
      data: {
        status: 'approved',
        approvedById,
        approvedAt: new Date(),
      },
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
              select: { id: true, name: true, standardUnit: true, currentPrepStock: true },
            },
          },
        },
        transactions: true,
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
          costPerUnit: item.costPerUnit ? Number(item.costPerUnit) : null,
          totalCost: item.totalCost ? Number(item.totalCost) : null,
          // Map ingredient to prepItem for frontend compatibility
          prepItem: {
            id: item.ingredient.id,
            name: item.ingredient.name,
            outputUnit: item.ingredient.standardUnit || 'each',
            currentPrepStock: Number(item.ingredient.currentPrepStock),
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
        transactionsSummary: {
          prepItemsUpdated: transactions.filter(t => t.type === 'prep_stock_add').length,
          ingredientsDeducted: transactions.filter(t => t.type === 'ingredient_deduct').length,
          totalCostImpact: transactions
            .filter(t => t.type === 'ingredient_deduct')
            .reduce((sum, t) => sum + (t.totalCost || 0), 0),
        },
      },
    })
  } catch (error) {
    console.error('Approve daily count error:', error)
    return NextResponse.json({ error: 'Failed to approve daily count' }, { status: 500 })
  }
})
