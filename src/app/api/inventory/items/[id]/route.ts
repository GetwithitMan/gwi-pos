import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { InventoryStockChangePayload } from '@/lib/socket-events'
import { queueSocketEvent, flushSocketOutbox } from '@/lib/socket-outbox'
import { notifyDataChanged } from '@/lib/cloud-notify'

// GET - Get single inventory item
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const item = await db.inventoryItem.findUnique({
      where: { id },
      include: {
        defaultVendor: {
          select: { id: true, name: true },
        },
        spiritCategory: {
          select: { id: true, name: true },
        },
        storageLocations: {
          include: {
            storageLocation: {
              select: { id: true, name: true },
            },
          },
        },
      },
    })

    if (!item || item.deletedAt) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    return NextResponse.json({ data: {
      item: {
        ...item,
        purchaseSize: Number(item.purchaseSize),
        purchaseCost: Number(item.purchaseCost),
        unitsPerPurchase: Number(item.unitsPerPurchase),
        costPerUnit: Number(item.costPerUnit),
        yieldPercent: Number(item.yieldPercent),
        yieldCostPerUnit: item.yieldCostPerUnit ? Number(item.yieldCostPerUnit) : null,
        pourSizeOz: item.pourSizeOz ? Number(item.pourSizeOz) : null,
        proofPercent: item.proofPercent ? Number(item.proofPercent) : null,
        currentStock: Number(item.currentStock),
        parLevel: item.parLevel ? Number(item.parLevel) : null,
        reorderPoint: item.reorderPoint ? Number(item.reorderPoint) : null,
        reorderQty: item.reorderQty ? Number(item.reorderQty) : null,
        storageLocations: item.storageLocations.map(sl => ({
          ...sl,
          currentStock: Number(sl.currentStock),
          parLevel: sl.parLevel ? Number(sl.parLevel) : null,
        })),
      },
    } })
  } catch (error) {
    console.error('Get inventory item error:', error)
    return NextResponse.json({ error: 'Failed to fetch inventory item' }, { status: 500 })
  }
})

// PUT - Update inventory item
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Check if item exists
    const existing = await db.inventoryItem.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    // Build update data
    const updateData: Record<string, unknown> = {}

    // Direct fields
    const directFields = [
      'name', 'sku', 'description', 'department', 'itemType', 'revenueCenter',
      'category', 'subcategory', 'brand', 'purchaseUnit', 'storageUnit',
      'costingMethod', 'spiritCategoryId', 'defaultVendorId', 'isActive', 'trackInventory',
    ]

    for (const field of directFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    // Decimal fields
    const decimalFields = [
      'purchaseSize', 'purchaseCost', 'unitsPerPurchase', 'yieldPercent',
      'pourSizeOz', 'proofPercent', 'parLevel', 'reorderPoint', 'reorderQty', 'currentStock',
    ]

    for (const field of decimalFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field] === null ? null : Number(body[field])
      }
    }

    // Recalculate cost per unit if relevant fields changed
    const purchaseCost = Number(updateData.purchaseCost ?? existing.purchaseCost)
    const unitsPerPurchase = Number(updateData.unitsPerPurchase ?? existing.unitsPerPurchase)
    const yieldPercent = Number(updateData.yieldPercent ?? existing.yieldPercent)

    const costPerUnit = unitsPerPurchase > 0 ? purchaseCost / unitsPerPurchase : 0
    updateData.costPerUnit = costPerUnit

    if (yieldPercent < 100 && yieldPercent > 0) {
      updateData.yieldCostPerUnit = costPerUnit / (yieldPercent / 100)
    } else {
      updateData.yieldCostPerUnit = null
    }

    // Track if cost changed
    if (body.purchaseCost !== undefined && Number(body.purchaseCost) !== Number(existing.purchaseCost)) {
      updateData.lastPriceUpdate = new Date()
      updateData.priceSource = body.priceSource || 'manual'
    }

    // Detect if stock is changing to queue socket event
    const stockChanged = body.currentStock !== undefined &&
      Number(body.currentStock) !== Number(existing.currentStock)

    // Wrap update + socket outbox in a single atomic transaction
    const item = await db.$transaction(async (tx) => {
      const result = await tx.inventoryItem.update({
        where: { id },
        data: updateData,
        include: {
          defaultVendor: {
            select: { id: true, name: true },
          },
        },
      })

      // Queue critical socket event if stock changed (outbox pattern)
      if (stockChanged) {
        const newStock = Number(result.currentStock)
        const prevStock = Number(existing.currentStock)
        const parLevel = existing.parLevel ? Number(existing.parLevel) : null
        const stockLevel = newStock <= 0 ? 'critical'
          : (parLevel && newStock <= parLevel * 0.25) ? 'low'
          : (parLevel && newStock <= parLevel * 0.5) ? 'ok'
          : 'good'

        const stockPayload: InventoryStockChangePayload = {
          ingredientId: id,
          name: result.name,
          currentStock: newStock,
          previousStock: prevStock,
          unit: result.storageUnit || 'each',
          stockLevel,
        }
        await queueSocketEvent(tx, existing.locationId, SOCKET_EVENTS.INVENTORY_STOCK_CHANGE, stockPayload)
      }

      return result
    })

    // Transaction committed — flush outbox if stock changed
    if (stockChanged) {
      void flushSocketOutbox(existing.locationId).catch((err) => {
        console.warn('[inventory/items/update] Outbox flush failed, catch-up will deliver:', err)
      })
    }

    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'updated', entityId: id })

    return NextResponse.json({ data: {
      item: {
        ...item,
        purchaseSize: Number(item.purchaseSize),
        purchaseCost: Number(item.purchaseCost),
        unitsPerPurchase: Number(item.unitsPerPurchase),
        costPerUnit: Number(item.costPerUnit),
        yieldPercent: Number(item.yieldPercent),
        yieldCostPerUnit: item.yieldCostPerUnit ? Number(item.yieldCostPerUnit) : null,
        currentStock: Number(item.currentStock),
      },
    } })
  } catch (error) {
    console.error('Update inventory item error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Item with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to update inventory item' }, { status: 500 })
  }
})

// DELETE - Soft delete inventory item
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.inventoryItem.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    // Wrap soft-delete + socket outbox in a single atomic transaction
    await db.$transaction(async (tx) => {
      await tx.inventoryItem.update({
        where: { id },
        data: { deletedAt: new Date() },
      })

      // Queue critical socket event for stock change (item removed from inventory)
      const stockPayload: InventoryStockChangePayload = {
        ingredientId: id,
        name: existing.name,
        currentStock: 0,
        previousStock: Number(existing.currentStock),
        unit: existing.storageUnit || 'each',
        stockLevel: 'critical',
      }
      await queueSocketEvent(tx, existing.locationId, SOCKET_EVENTS.INVENTORY_STOCK_CHANGE, stockPayload)
    })

    // Transaction committed — flush outbox
    void flushSocketOutbox(existing.locationId).catch((err) => {
      console.warn('[inventory/items/delete] Outbox flush failed, catch-up will deliver:', err)
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'deleted', entityId: id })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Delete inventory item error:', error)
    return NextResponse.json({ error: 'Failed to delete inventory item' }, { status: 500 })
  }
})
