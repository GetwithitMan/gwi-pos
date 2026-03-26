import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// PATCH - Batch update count entries (save counts as user enters them)
export const PATCH = withVenue(withAuth('ADMIN', async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { entries } = body

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'Entries array required' }, { status: 400 })
    }

    // Verify count exists and is in_progress
    const count = await db.inventoryCount.findUnique({
      where: { id },
      select: { id: true, status: true, locationId: true, deletedAt: true },
    })

    if (!count || count.deletedAt) {
      return NextResponse.json({ error: 'Inventory count not found' }, { status: 404 })
    }

    if (count.status !== 'in_progress') {
      return NextResponse.json({ error: 'Count is not in progress' }, { status: 400 })
    }

    // Fetch inventory items for cost calculation
    const itemIds = entries.map((e: { inventoryItemId: string }) => e.inventoryItemId)
    const invItems = await db.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, costPerUnit: true, currentStock: true, storageUnit: true },
    })
    const invItemMap = new Map(invItems.map(i => [i.id, i]))

    // Upsert each entry
    const updatedEntries = []
    for (const entry of entries) {
      const { inventoryItemId, countedQty, notes } = entry
      const invItem = invItemMap.get(inventoryItemId)
      if (!invItem) continue

      const expectedQty = Number(invItem.currentStock)
      const counted = Number(countedQty)
      const variance = counted - expectedQty
      const unitCost = Number(invItem.costPerUnit)
      const varianceCost = Math.abs(variance) * unitCost

      const upserted = await db.inventoryCountEntry.upsert({
        where: {
          inventoryCountId_inventoryItemId: {
            inventoryCountId: id,
            inventoryItemId,
          },
        },
        update: {
          countedQty: counted,
          variance,
          varianceCost,
          notes: notes || null,
        },
        create: {
          locationId: count.locationId,
          inventoryCountId: id,
          inventoryItemId,
          expectedQty: expectedQty,
          countedQty: counted,
          unit: invItem.storageUnit,
          unitCost,
          variance,
          varianceCost,
          notes: notes || null,
        },
      })

      updatedEntries.push({
        ...upserted,
        expectedQty: upserted.expectedQty ? Number(upserted.expectedQty) : expectedQty,
        countedQty: Number(upserted.countedQty),
        variance: upserted.variance ? Number(upserted.variance) : variance,
        varianceCost: upserted.varianceCost ? Number(upserted.varianceCost) : varianceCost,
        unitCost: Number(upserted.unitCost),
      })
    }

    void notifyDataChanged({ locationId: count.locationId, domain: 'inventory', action: 'updated', entityId: id })
    pushUpstream()

    return NextResponse.json({ data: { entries: updatedEntries } })
  } catch (error) {
    console.error('Update count entries error:', error)
    return NextResponse.json({ error: 'Failed to update count entries' }, { status: 500 })
  }
}))
