import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List waste log entries
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const reason = searchParams.get('reason')
    const inventoryItemId = searchParams.get('inventoryItemId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (reason) where.reason = reason
    if (inventoryItemId) where.inventoryItemId = inventoryItemId

    if (startDate || endDate) {
      where.wasteDate = {}
      if (startDate) (where.wasteDate as Record<string, Date>).gte = new Date(startDate)
      if (endDate) (where.wasteDate as Record<string, Date>).lte = new Date(endDate)
    }

    const entries = await db.wasteLogEntry.findMany({
      where,
      include: {
        inventoryItem: {
          select: { id: true, name: true, sku: true, category: true },
        },
      },
      orderBy: { wasteDate: 'desc' },
    })

    return NextResponse.json({ data: {
      entries: entries.map(entry => ({
        ...entry,
        quantity: Number(entry.quantity),
        costImpact: entry.costImpact ? Number(entry.costImpact) : null,
      })),
    } })
  } catch (error) {
    console.error('Waste log list error:', error)
    return NextResponse.json({ error: 'Failed to fetch waste log' }, { status: 500 })
  }
})

// POST - Create waste log entry
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      inventoryItemId,
      employeeId,
      reason,
      quantity,
      unit,
      notes,
    } = body

    if (!locationId || !inventoryItemId || !reason || !quantity || !unit) {
      return NextResponse.json({
        error: 'Location ID, inventory item, reason, quantity, and unit required',
      }, { status: 400 })
    }

    // Validate reason type
    const allowedReasons = ['spoilage', 'spill', 'overcooked', 'contamination', 'training']
    if (!allowedReasons.includes(reason)) {
      return NextResponse.json({
        error: `Invalid reason. Must be one of: ${allowedReasons.join(', ')}`,
      }, { status: 400 })
    }

    // Get current item cost
    const item = await db.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { costPerUnit: true, currentStock: true },
    })

    if (!item) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
    }

    const costPerUnit = Number(item.costPerUnit)
    const qtyNum = Number(quantity)
    const costImpact = costPerUnit * qtyNum
    const currentStock = Number(item.currentStock)

    // Create waste log entry
    const entry = await db.wasteLogEntry.create({
      data: {
        locationId,
        inventoryItemId,
        employeeId,
        reason,
        quantity: qtyNum,
        unit,
        costImpact,
        notes,
        wasteDate: new Date(),
      },
      include: {
        inventoryItem: {
          select: { id: true, name: true, sku: true },
        },
      },
    })

    // Deduct from inventory
    await db.inventoryItem.update({
      where: { id: inventoryItemId },
      data: {
        currentStock: { decrement: qtyNum },
      },
    })

    // Create transaction record
    await db.inventoryItemTransaction.create({
      data: {
        locationId,
        inventoryItemId,
        type: 'waste',
        quantityBefore: currentStock,
        quantityChange: -qtyNum,
        quantityAfter: currentStock - qtyNum,
        unitCost: costPerUnit,
        totalCost: costImpact,
        reason: notes || `Waste: ${reason}`,
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
    console.error('Create waste log entry error:', error)
    return NextResponse.json({ error: 'Failed to create waste log entry' }, { status: 500 })
  }
})
