import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get single inventory count with items
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const count = await db.inventoryCount.findUnique({
      where: { id },
      include: {
        storageLocation: {
          select: { id: true, name: true },
        },
        items: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                sku: true,
                category: true,
                storageUnit: true,
                costPerUnit: true,
              },
            },
          },
          orderBy: {
            inventoryItem: { category: 'asc' },
          },
        },
      },
    })

    if (!count || count.deletedAt) {
      return NextResponse.json({ error: 'Inventory count not found' }, { status: 404 })
    }

    return NextResponse.json({ data: {
      count: {
        ...count,
        varianceValue: count.varianceValue ? Number(count.varianceValue) : null,
        expectedValue: count.expectedValue ? Number(count.expectedValue) : null,
        countedValue: count.countedValue ? Number(count.countedValue) : null,
        items: count.items.map(item => ({
          ...item,
          expectedQty: Number(item.expectedQty),
          countedQty: item.countedQty !== null ? Number(item.countedQty) : null,
          variance: item.variance !== null ? Number(item.variance) : null,
          varianceValue: item.varianceValue !== null ? Number(item.varianceValue) : null,
          inventoryItem: {
            ...item.inventoryItem,
            costPerUnit: Number(item.inventoryItem.costPerUnit),
          },
        })),
      },
    } })
  } catch (error) {
    console.error('Get inventory count error:', error)
    return NextResponse.json({ error: 'Failed to fetch inventory count' }, { status: 500 })
  }
})

// PUT - Update count (record counts, complete, approve)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.inventoryCount.findUnique({
      where: { id },
      include: { items: true },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Inventory count not found' }, { status: 404 })
    }

    // Handle item count updates
    if (body.items) {
      // Pre-fetch all inventory items for cost calculation (batch instead of N+1)
      const inventoryItemIds = body.items
        .map((u: { id: string }) => existing.items.find(i => i.id === u.id)?.inventoryItemId)
        .filter(Boolean) as string[]
      const invItems = await db.inventoryItem.findMany({
        where: { id: { in: inventoryItemIds } },
        select: { id: true, costPerUnit: true },
      })
      const invItemMap = new Map(invItems.map(i => [i.id, i]))

      for (const itemUpdate of body.items) {
        const countItem = existing.items.find(i => i.id === itemUpdate.id)
        if (!countItem) continue

        const countedQty = Number(itemUpdate.countedQty)
        const expectedQty = Number(countItem.expectedQty)
        const varianceQty = countedQty - expectedQty

        const invItem = invItemMap.get(countItem.inventoryItemId)
        const costPerUnit = invItem ? Number(invItem.costPerUnit) : 0
        const varianceValue = varianceQty * costPerUnit
        const variancePct = expectedQty > 0 ? (varianceQty / expectedQty) * 100 : 0

        await db.inventoryCountItem.update({
          where: { id: itemUpdate.id },
          data: {
            countedQty: countedQty,
            variance: varianceQty,
            varianceValue: varianceValue,
            variancePct: variancePct,
            countedAt: new Date(),
            notes: itemUpdate.notes,
          },
        })
      }
    }

    // Handle status changes
    const updateData: Record<string, unknown> = {}

    if (body.status === 'in_progress' && existing.status === 'pending') {
      updateData.status = 'in_progress'
    }

    if (body.status === 'completed' && existing.status !== 'completed') {
      // Calculate total variance
      const items = await db.inventoryCountItem.findMany({
        where: { inventoryCountId: id },
      })

      let totalVariance = 0
      let totalExpected = 0
      let totalCounted = 0
      for (const item of items) {
        if (item.varianceValue) {
          totalVariance += Number(item.varianceValue)
        }
        totalExpected += Number(item.expectedQty)
        if (item.countedQty) {
          totalCounted += Number(item.countedQty)
        }
      }

      const variancePct = totalExpected > 0 ? (totalVariance / totalExpected) * 100 : 0

      updateData.status = 'completed'
      updateData.completedAt = new Date()
      updateData.varianceValue = totalVariance
      updateData.variancePct = variancePct
    }

    if (body.status === 'reviewed' && existing.status === 'completed') {
      if (!body.reviewedById) {
        return NextResponse.json({ error: 'Reviewer ID required' }, { status: 400 })
      }

      // Apply counts to inventory
      const items = await db.inventoryCountItem.findMany({
        where: { inventoryCountId: id },
      })

      // Pre-fetch all inventory items for stock levels (batch instead of N+1)
      const countedItems = items.filter(item => item.countedQty !== null)
      const reviewInvItemIds = countedItems.map(item => item.inventoryItemId)
      const reviewInvItems = await db.inventoryItem.findMany({
        where: { id: { in: reviewInvItemIds } },
        select: { id: true, currentStock: true, costPerUnit: true },
      })
      const reviewInvItemMap = new Map(reviewInvItems.map(i => [i.id, i]))

      for (const item of countedItems) {
        const invItem = reviewInvItemMap.get(item.inventoryItemId)
        const currentStock = invItem ? Number(invItem.currentStock) : 0
        const countedQty = Number(item.countedQty)

        await db.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            currentStock: item.countedQty ?? 0,
          },
        })

        // Create transaction record if there's a variance
        if (item.variance && Number(item.variance) !== 0) {
          await db.inventoryItemTransaction.create({
            data: {
              locationId: existing.locationId,
              inventoryItemId: item.inventoryItemId,
              type: 'count',
              quantityBefore: currentStock,
              quantityChange: Number(item.variance),
              quantityAfter: countedQty,
              unitCost: invItem?.costPerUnit,
              totalCost: item.varianceValue,
              reason: `Count adjustment - ${existing.countType}`,
            },
          })
        }
      }

      updateData.status = 'reviewed'
      updateData.reviewedById = body.reviewedById
      updateData.reviewedAt = new Date()
    }

    if (body.notes !== undefined) {
      updateData.notes = body.notes
    }

    const count = await db.inventoryCount.update({
      where: { id },
      data: updateData,
      include: {
        storageLocation: {
          select: { id: true, name: true },
        },
        _count: {
          select: { items: true },
        },
      },
    })

    return NextResponse.json({ data: {
      count: {
        ...count,
        varianceValue: count.varianceValue ? Number(count.varianceValue) : null,
        expectedValue: count.expectedValue ? Number(count.expectedValue) : null,
        countedValue: count.countedValue ? Number(count.countedValue) : null,
      },
    } })
  } catch (error) {
    console.error('Update inventory count error:', error)
    return NextResponse.json({ error: 'Failed to update inventory count' }, { status: 500 })
  }
})

// DELETE - Soft delete inventory count
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.inventoryCount.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Inventory count not found' }, { status: 404 })
    }

    if (existing.status === 'approved') {
      return NextResponse.json({
        error: 'Cannot delete approved inventory count',
      }, { status: 400 })
    }

    await db.inventoryCount.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Delete inventory count error:', error)
    return NextResponse.json({ error: 'Failed to delete inventory count' }, { status: 500 })
  }
})
