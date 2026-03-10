import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

// GET /api/reports/vendor-comparison
// For each inventory item, show prices from different vendors (from VendorOrderLineItem records)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const category = searchParams.get('category') // optional filter by InventoryItem.category

    // Fetch all vendors for this location
    const vendors = await db.vendor.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    const vendorMap = new Map(vendors.map(v => [v.id, v.name]))

    // Fetch all vendor order line items with their vendor info
    // We want the most recent price per (inventoryItem, vendor) pair
    const lineItems = await db.vendorOrderLineItem.findMany({
      where: {
        locationId,
        deletedAt: null,
        vendorOrder: {
          locationId,
          deletedAt: null,
          // Only consider received/completed orders for actual pricing
          status: { in: ['received', 'partially_received'] },
        },
        ...(category
          ? { inventoryItem: { category, locationId, deletedAt: null } }
          : { inventoryItem: { locationId, deletedAt: null } }),
      },
      select: {
        inventoryItemId: true,
        estimatedCost: true,
        actualCost: true,
        quantity: true,
        unit: true,
        vendorOrder: {
          select: {
            vendorId: true,
            orderDate: true,
          },
        },
      },
      orderBy: {
        vendorOrder: { orderDate: 'desc' },
      },
    })

    // Also get inventory items info
    const inventoryItems = await db.inventoryItem.findMany({
      where: {
        locationId,
        deletedAt: null,
        isActive: true,
        ...(category ? { category } : {}),
      },
      select: {
        id: true,
        name: true,
        category: true,
        purchaseUnit: true,
        purchaseCost: true,
        defaultVendorId: true,
      },
      orderBy: { name: 'asc' },
    })

    // Build price map: inventoryItemId -> vendorId -> { lastPrice, previousPrice, orderDate, unit }
    const priceMap = new Map<string, Map<string, { lastPrice: number; previousPrice: number | null; orderDate: string; unit: string }>>()

    for (const li of lineItems) {
      const itemId = li.inventoryItemId
      const vendorId = li.vendorOrder.vendorId
      const price = Number(li.actualCost ?? li.estimatedCost ?? 0)
      const qty = Number(li.quantity)
      // Compute unit price
      const unitPrice = qty > 0 ? price / qty : price

      if (!priceMap.has(itemId)) {
        priceMap.set(itemId, new Map())
      }
      const vendorPrices = priceMap.get(itemId)!

      if (!vendorPrices.has(vendorId)) {
        // First (most recent) entry for this vendor+item
        vendorPrices.set(vendorId, {
          lastPrice: unitPrice,
          previousPrice: null,
          orderDate: li.vendorOrder.orderDate.toISOString(),
          unit: li.unit,
        })
      } else {
        // Second entry becomes "previous price" for trend detection
        const existing = vendorPrices.get(vendorId)!
        if (existing.previousPrice === null) {
          existing.previousPrice = unitPrice
        }
      }
    }

    // Build comparison data per inventory item
    const comparison = inventoryItems
      .map(item => {
        const vendorPrices = priceMap.get(item.id)

        // Build vendor price entries
        const prices: {
          vendorId: string
          vendorName: string
          unitPrice: number
          previousPrice: number | null
          trend: 'up' | 'down' | 'stable'
          unit: string
          lastOrderDate: string
        }[] = []

        if (vendorPrices) {
          for (const [vendorId, data] of vendorPrices) {
            const vendorName = vendorMap.get(vendorId) || 'Unknown'
            let trend: 'up' | 'down' | 'stable' = 'stable'
            if (data.previousPrice !== null) {
              if (data.lastPrice > data.previousPrice * 1.005) trend = 'up'
              else if (data.lastPrice < data.previousPrice * 0.995) trend = 'down'
            }

            prices.push({
              vendorId,
              vendorName,
              unitPrice: Math.round(data.lastPrice * 10000) / 10000,
              previousPrice: data.previousPrice !== null ? Math.round(data.previousPrice * 10000) / 10000 : null,
              trend,
              unit: data.unit,
              lastOrderDate: data.orderDate,
            })
          }
        }

        // Sort prices by unit price ascending
        prices.sort((a, b) => a.unitPrice - b.unitPrice)

        const bestPrice = prices.length > 0 ? prices[0].unitPrice : null
        const bestVendorId = prices.length > 0 ? prices[0].vendorId : null
        const worstPrice = prices.length > 1 ? prices[prices.length - 1].unitPrice : null
        const priceDifference = bestPrice !== null && worstPrice !== null && prices.length > 1
          ? Math.round((worstPrice - bestPrice) * 10000) / 10000
          : 0

        return {
          itemId: item.id,
          itemName: item.name,
          category: item.category,
          purchaseUnit: item.purchaseUnit,
          currentCost: Number(item.purchaseCost),
          defaultVendorId: item.defaultVendorId,
          defaultVendorName: item.defaultVendorId ? vendorMap.get(item.defaultVendorId) || null : null,
          prices,
          bestPrice,
          bestVendorId,
          priceDifference,
        }
      })
      // Only include items that have vendor price data
      .filter(item => item.prices.length > 0)

    // Calculate total potential savings
    // Sum of (current cost - best vendor price) for items where best vendor is cheaper
    let totalPotentialSavings = 0
    for (const item of comparison) {
      if (item.bestPrice !== null && item.bestPrice < item.currentCost) {
        totalPotentialSavings += item.currentCost - item.bestPrice
      }
    }

    // Get unique categories for filter dropdown
    const categories = [...new Set(inventoryItems.map(i => i.category))].sort()

    return NextResponse.json({
      data: {
        vendors: vendors.map(v => ({ id: v.id, name: v.name })),
        categories,
        comparison,
        summary: {
          totalItems: comparison.length,
          itemsWithMultipleVendors: comparison.filter(c => c.prices.length > 1).length,
          totalPotentialSavings: Math.round(totalPotentialSavings * 100) / 100,
        },
      },
    })
  } catch (error) {
    console.error('Failed to fetch vendor comparison:', error)
    return NextResponse.json({ error: 'Failed to fetch vendor comparison' }, { status: 500 })
  }
})
