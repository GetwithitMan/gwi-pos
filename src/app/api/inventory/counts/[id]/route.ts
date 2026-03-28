import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

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
      return notFound('Inventory count not found')
    }

    return ok({
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
    })
  } catch (error) {
    console.error('Get inventory count error:', error)
    return err('Failed to fetch inventory count', 500)
  }
})

// PUT - Update count (record counts, complete, approve)
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
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
      return notFound('Inventory count not found')
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
            lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
          },
        })
      }
    }

    // Handle status changes
    const updateData: Record<string, unknown> = {}

    if (body.status === 'in_progress' && (existing.status as string) === 'pending') {
      updateData.status = 'in_progress'
    }

    if (body.status === 'completed' && existing.status !== 'completed') {
      // Calculate total variance from both InventoryCountItems and InventoryCountEntries
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

      // Also sum from InventoryCountEntry (COGS-style entries)
      const entries = await db.inventoryCountEntry.findMany({
        where: { inventoryCountId: id },
      })

      let totalVarianceCost = 0
      for (const entry of entries) {
        if (entry.varianceCost) {
          totalVarianceCost += Number(entry.varianceCost)
        }
      }

      const variancePct = totalExpected > 0 ? (totalVariance / totalExpected) * 100 : 0

      updateData.status = 'completed'
      updateData.completedAt = new Date()
      updateData.completedById = body.completedById || null
      updateData.varianceValue = totalVariance
      updateData.variancePct = variancePct
      updateData.totalVarianceCost = totalVarianceCost || totalVariance
    }

    if (body.status === 'reviewed' && existing.status === 'completed') {
      if (!body.reviewedById) {
        return err('Reviewer ID required')
      }

      // Apply counts to inventory — wrapped in interactive transaction
      // to prevent TOCTOU races between stock read and update.
      const items = await db.inventoryCountItem.findMany({
        where: { inventoryCountId: id },
      })

      const countedItems = items.filter(item => item.countedQty !== null)

      await db.$transaction(async (tx) => {
        for (const item of countedItems) {
          // C10: Skip uncounted items — don't wipe their stock to 0
          if (item.countedQty === null || item.countedQty === undefined) {
            continue
          }

          const countedQty = Number(item.countedQty)

          // Update stock and read the pre-update value atomically
          const invItemBefore = await tx.inventoryItem.findUnique({
            where: { id: item.inventoryItemId },
            select: { currentStock: true, costPerUnit: true },
          })
          const currentStock = invItemBefore ? Number(invItemBefore.currentStock) : 0

          await tx.inventoryItem.update({
            where: { id: item.inventoryItemId },
            data: {
              currentStock: countedQty,
            },
          })

          // Create transaction record if there's a variance
          if (item.variance && Number(item.variance) !== 0) {
            await tx.inventoryItemTransaction.create({
              data: {
                locationId: existing.locationId,
                inventoryItemId: item.inventoryItemId,
                type: 'count',
                quantityBefore: currentStock,
                quantityChange: Number(item.variance),
                quantityAfter: countedQty,
                unitCost: invItemBefore?.costPerUnit,
                totalCost: item.varianceValue,
                reason: `Count adjustment - ${existing.countType}`,
              },
            })
          }
        }
      })

      updateData.status = 'reviewed'
      updateData.reviewedById = body.reviewedById
      updateData.reviewedAt = new Date()
    }

    if (body.notes !== undefined) {
      updateData.notes = body.notes
    }

    updateData.lastMutatedBy = process.env.VERCEL ? 'cloud' : 'local'

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

    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({
      count: {
        ...count,
        varianceValue: count.varianceValue ? Number(count.varianceValue) : null,
        expectedValue: count.expectedValue ? Number(count.expectedValue) : null,
        countedValue: count.countedValue ? Number(count.countedValue) : null,
      },
    })
  } catch (error) {
    console.error('Update inventory count error:', error)
    return err('Failed to update inventory count', 500)
  }
}))

// DELETE - Soft delete inventory count
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.inventoryCount.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return notFound('Inventory count not found')
    }

    if ((existing.status as string) === 'approved') {
      return err('Cannot delete approved inventory count')
    }

    await db.inventoryCount.update({
      where: { id },
      data: { deletedAt: new Date(), lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Delete inventory count error:', error)
    return err('Failed to delete inventory count', 500)
  }
}))
