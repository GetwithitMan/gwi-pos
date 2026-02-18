import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get single waste log entry
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const entry = await db.wasteLogEntry.findUnique({
      where: { id },
      include: {
        inventoryItem: {
          select: { id: true, name: true, sku: true, category: true, storageUnit: true },
        },
      },
    })

    if (!entry || entry.deletedAt) {
      return NextResponse.json({ error: 'Waste log entry not found' }, { status: 404 })
    }

    return NextResponse.json({ data: {
      entry: {
        ...entry,
        quantity: Number(entry.quantity),
        costImpact: entry.costImpact ? Number(entry.costImpact) : null,
      },
    } })
  } catch (error) {
    console.error('Get waste log entry error:', error)
    return NextResponse.json({ error: 'Failed to fetch waste log entry' }, { status: 500 })
  }
})

// PUT - Update waste log entry (limited updates)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.wasteLogEntry.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Waste log entry not found' }, { status: 404 })
    }

    // Only allow updating notes - reason and quantity changes require reversal
    const updateData: Record<string, unknown> = {}
    if (body.notes !== undefined) updateData.notes = body.notes

    const entry = await db.wasteLogEntry.update({
      where: { id },
      data: updateData,
      include: {
        inventoryItem: {
          select: { id: true, name: true, sku: true },
        },
      },
    })

    return NextResponse.json({ data: {
      entry: {
        ...entry,
        quantity: Number(entry.quantity),
        costImpact: entry.costImpact ? Number(entry.costImpact) : null,
      },
    } })
  } catch (error) {
    console.error('Update waste log entry error:', error)
    return NextResponse.json({ error: 'Failed to update waste log entry' }, { status: 500 })
  }
})

// DELETE - Reverse and soft delete waste log entry (atomic transaction)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.wasteLogEntry.findUnique({
      where: { id },
      include: {
        inventoryItem: {
          select: { currentStock: true, costPerUnit: true },
        },
      },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Waste log entry not found' }, { status: 404 })
    }

    const qtyToRestore = Number(existing.quantity)
    const currentStock = Number(existing.inventoryItem?.currentStock || 0)
    const costPerUnit = Number(existing.inventoryItem?.costPerUnit || 0)

    // Atomic transaction: all operations succeed or all fail
    await db.$transaction([
      // 1. Reverse the inventory deduction
      db.inventoryItem.update({
        where: { id: existing.inventoryItemId },
        data: {
          currentStock: { increment: qtyToRestore },
        },
      }),

      // 2. Create reversal transaction record
      db.inventoryItemTransaction.create({
        data: {
          locationId: existing.locationId,
          inventoryItemId: existing.inventoryItemId,
          type: 'adjustment',
          quantityBefore: currentStock,
          quantityChange: qtyToRestore,
          quantityAfter: currentStock + qtyToRestore,
          unitCost: costPerUnit,
          totalCost: existing.costImpact ? Number(existing.costImpact) : qtyToRestore * costPerUnit,
          reason: 'Waste log entry reversed',
        },
      }),

      // 3. Soft delete the waste log entry
      db.wasteLogEntry.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    ])

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Delete waste log entry error:', error)
    return NextResponse.json({ error: 'Failed to delete waste log entry' }, { status: 500 })
  }
})
