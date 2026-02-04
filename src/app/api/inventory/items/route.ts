import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List inventory items with filtering and pagination
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const department = searchParams.get('department')
    const itemType = searchParams.get('itemType')
    const revenueCenter = searchParams.get('revenueCenter')
    const category = searchParams.get('category')
    const search = searchParams.get('search')
    const lowStockOnly = searchParams.get('lowStockOnly') === 'true'
    const activeOnly = searchParams.get('activeOnly') !== 'false'

    // Pagination params
    const limit = searchParams.get('limit')
    const skip = searchParams.get('skip')
    const cursor = searchParams.get('cursor') // For cursor-based pagination (alternative)

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (activeOnly) where.isActive = true
    if (department) where.department = department
    if (itemType) where.itemType = itemType
    if (revenueCenter) where.revenueCenter = revenueCenter
    if (category) where.category = category

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
        { brand: { contains: search } },
      ]
    }

    if (lowStockOnly) {
      where.AND = [
        { trackInventory: true },
        { parLevel: { not: null } },
        { currentStock: { lte: db.inventoryItem.fields.parLevel } },
      ]
    }

    // Build query options with optional pagination
    const take = limit ? parseInt(limit) : undefined
    const skipCount = skip ? parseInt(skip) : undefined

    // Run count and query in parallel for efficiency (only count if paginating)
    const [total, items] = await Promise.all([
      take ? db.inventoryItem.count({ where }) : Promise.resolve(0),
      db.inventoryItem.findMany({
        where,
        include: {
          defaultVendor: {
            select: { id: true, name: true },
          },
          spiritCategory: {
            select: { id: true, name: true },
          },
        },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        ...(take && { take: take + 1 }), // Fetch one extra to check if there's more
        ...(skipCount && { skip: skipCount }),
        ...(cursor && { cursor: { id: cursor }, skip: 1 }), // Skip the cursor item itself
      }),
    ])

    // Check if there are more items
    const hasMore = take ? items.length > take : false
    const returnItems = hasMore ? items.slice(0, -1) : items // Remove the extra item

    const mappedItems = returnItems.map(item => ({
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
      isLowStock: item.parLevel ? Number(item.currentStock) <= Number(item.parLevel) : false,
    }))

    // Return with pagination info if paginating
    if (take) {
      return NextResponse.json({
        items: mappedItems,
        pagination: {
          total,
          limit: take,
          skip: skipCount || 0,
          hasMore,
          nextCursor: hasMore && returnItems.length > 0 ? returnItems[returnItems.length - 1].id : null,
        },
      })
    }

    // Legacy response format (no pagination)
    return NextResponse.json({ items: mappedItems })
  } catch (error) {
    console.error('Inventory items list error:', error)
    return NextResponse.json({ error: 'Failed to fetch inventory items' }, { status: 500 })
  }
}

// POST - Create inventory item
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      sku,
      description,
      department,
      itemType,
      revenueCenter,
      category,
      subcategory,
      brand,
      purchaseUnit,
      purchaseSize,
      purchaseCost,
      defaultVendorId,
      storageUnit,
      unitsPerPurchase,
      costingMethod,
      yieldPercent,
      spiritCategoryId,
      pourSizeOz,
      proofPercent,
      parLevel,
      reorderPoint,
      reorderQty,
      trackInventory,
    } = body

    // Validate required fields
    if (!locationId || !name || !department || !itemType || !revenueCenter || !category) {
      return NextResponse.json({
        error: 'Missing required fields: locationId, name, department, itemType, revenueCenter, category',
      }, { status: 400 })
    }

    if (!purchaseUnit || !purchaseSize || !purchaseCost || !storageUnit || !unitsPerPurchase) {
      return NextResponse.json({
        error: 'Missing required purchase/storage fields',
      }, { status: 400 })
    }

    // Calculate cost per unit
    const calcUnitsPerPurchase = Number(unitsPerPurchase)
    const calcPurchaseCost = Number(purchaseCost)
    const calcYieldPercent = Number(yieldPercent || 100)
    const costPerUnit = calcPurchaseCost / calcUnitsPerPurchase
    const yieldCostPerUnit = calcYieldPercent < 100
      ? costPerUnit / (calcYieldPercent / 100)
      : costPerUnit

    const item = await db.inventoryItem.create({
      data: {
        locationId,
        name,
        sku,
        description,
        department,
        itemType,
        revenueCenter,
        category,
        subcategory,
        brand,
        purchaseUnit,
        purchaseSize: Number(purchaseSize),
        purchaseCost: calcPurchaseCost,
        defaultVendorId,
        storageUnit,
        unitsPerPurchase: calcUnitsPerPurchase,
        costPerUnit,
        costingMethod: costingMethod || 'weighted_average',
        lastPriceUpdate: new Date(),
        priceSource: 'manual',
        yieldPercent: calcYieldPercent,
        yieldCostPerUnit: calcYieldPercent < 100 ? yieldCostPerUnit : null,
        spiritCategoryId,
        pourSizeOz: pourSizeOz ? Number(pourSizeOz) : null,
        proofPercent: proofPercent ? Number(proofPercent) : null,
        parLevel: parLevel ? Number(parLevel) : null,
        reorderPoint: reorderPoint ? Number(reorderPoint) : null,
        reorderQty: reorderQty ? Number(reorderQty) : null,
        trackInventory: trackInventory ?? true,
        currentStock: 0,
      },
      include: {
        defaultVendor: {
          select: { id: true, name: true },
        },
      },
    })

    return NextResponse.json({
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
    })
  } catch (error) {
    console.error('Create inventory item error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Item with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create inventory item' }, { status: 500 })
  }
}
