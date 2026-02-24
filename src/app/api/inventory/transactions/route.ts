import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET - List inventory transactions with pagination
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const queryLocationId = searchParams.get('locationId')
    const inventoryItemId = searchParams.get('inventoryItemId')
    const type = searchParams.get('type')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const search = searchParams.get('search')
    const limit = searchParams.get('limit')
    const skip = searchParams.get('skip') // Offset pagination support

    // Resolve locationId — query param → fallback to cached location
    const locationId = queryLocationId || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {}

    where.locationId = locationId
    if (inventoryItemId) where.inventoryItemId = inventoryItemId
    if (type) where.type = type

    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) (where.createdAt as Record<string, Date>).gte = new Date(startDate)
      if (endDate) {
        // Include the entire end date day
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        ;(where.createdAt as Record<string, Date>).lte = end
      }
    }

    // If searching, we need to filter by item name
    if (search) {
      where.inventoryItem = {
        name: { contains: search, mode: 'insensitive' },
      }
    }

    // Run count and query in parallel for efficiency
    const [total, transactions] = await Promise.all([
      db.inventoryItemTransaction.count({ where }),
      db.inventoryItemTransaction.findMany({
        where,
        include: {
          inventoryItem: {
            select: { id: true, name: true, sku: true, storageUnit: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit ? parseInt(limit) : 100,
        skip: skip ? parseInt(skip) : 0,
      }),
    ])

    const take = limit ? parseInt(limit) : 100
    const currentSkip = skip ? parseInt(skip) : 0

    return NextResponse.json({ data: {
      transactions: transactions.map(t => ({
        ...t,
        quantityBefore: Number(t.quantityBefore),
        quantityChange: Number(t.quantityChange),
        quantityAfter: Number(t.quantityAfter),
        unitCost: t.unitCost ? Number(t.unitCost) : null,
        totalCost: t.totalCost ? Number(t.totalCost) : null,
      })),
      pagination: {
        total,
        limit: take,
        skip: currentSkip,
        hasMore: currentSkip + transactions.length < total,
      },
    } })
  } catch (error) {
    console.error('Inventory transactions list error:', error)
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
  }
})

// POST - Create manual adjustment transaction
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      inventoryItemId,
      type,
      quantityChange,
      reason,
    } = body

    if (!locationId || !inventoryItemId || !type || quantityChange === undefined) {
      return NextResponse.json({
        error: 'Location ID, inventory item ID, type, and quantity change required',
      }, { status: 400 })
    }

    // Validate transaction type
    const allowedTypes = ['purchase', 'sale', 'adjustment', 'waste', 'transfer', 'count']
    if (!allowedTypes.includes(type)) {
      return NextResponse.json({
        error: `Invalid transaction type. Must be one of: ${allowedTypes.join(', ')}`,
      }, { status: 400 })
    }

    // Get item for cost calculation
    const item = await db.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { costPerUnit: true, currentStock: true },
    })

    if (!item) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
    }

    const qtyChange = Number(quantityChange)
    const currentStock = Number(item.currentStock)
    const costPerUnit = Number(item.costPerUnit)
    const totalCost = Math.abs(qtyChange) * costPerUnit

    // Create transaction
    const transaction = await db.inventoryItemTransaction.create({
      data: {
        locationId,
        inventoryItemId,
        type,
        quantityBefore: currentStock,
        quantityChange: qtyChange,
        quantityAfter: currentStock + qtyChange,
        unitCost: costPerUnit,
        totalCost,
        reason,
      },
    })

    // Update inventory stock
    await db.inventoryItem.update({
      where: { id: inventoryItemId },
      data: {
        currentStock: { increment: qtyChange },
      },
    })

    return NextResponse.json({ data: {
      transaction: {
        ...transaction,
        quantityBefore: Number(transaction.quantityBefore),
        quantityChange: Number(transaction.quantityChange),
        quantityAfter: Number(transaction.quantityAfter),
        unitCost: transaction.unitCost ? Number(transaction.unitCost) : null,
        totalCost: transaction.totalCost ? Number(transaction.totalCost) : null,
      },
    } })
  } catch (error) {
    console.error('Create inventory transaction error:', error)
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 })
  }
})
