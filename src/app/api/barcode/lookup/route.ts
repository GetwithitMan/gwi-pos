import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

// GET — Primary scan lookup endpoint
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const locationId = searchParams.get('locationId') || await getLocationId()

    if (!code) {
      return NextResponse.json({ error: 'code query parameter is required' }, { status: 400 })
    }

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    // Step 1: Look up in ItemBarcode table (exact match)
    const barcode = await db.itemBarcode.findFirst({
      where: {
        locationId,
        barcode: code,
        deletedAt: null,
      },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            price: true,
            categoryId: true,
            isAvailable: true,
          },
        },
        inventoryItem: {
          select: {
            id: true,
            name: true,
            currentStock: true,
          },
        },
      },
    })

    if (barcode) {
      return NextResponse.json({
        data: {
          barcode: barcode.barcode,
          label: barcode.label,
          packSize: barcode.packSize,
          price: barcode.price ? Number(barcode.price) : null,
          menuItem: barcode.menuItem ? {
            id: barcode.menuItem.id,
            name: barcode.menuItem.name,
            price: Number(barcode.menuItem.price),
            categoryId: barcode.menuItem.categoryId,
            isAvailable: barcode.menuItem.isAvailable,
          } : null,
          inventoryItem: barcode.inventoryItem ? {
            id: barcode.inventoryItem.id,
            name: barcode.inventoryItem.name,
            currentStock: Number(barcode.inventoryItem.currentStock),
          } : null,
          source: 'barcode',
        },
      })
    }

    // Step 2: Fall back to MenuItem.sku exact match (backwards compat)
    const menuItem = await db.menuItem.findFirst({
      where: {
        locationId,
        sku: code,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        price: true,
        categoryId: true,
        isAvailable: true,
        sku: true,
      },
    })

    if (menuItem) {
      return NextResponse.json({
        data: {
          barcode: menuItem.sku,
          label: null,
          packSize: 1,
          price: Number(menuItem.price),
          menuItem: {
            id: menuItem.id,
            name: menuItem.name,
            price: Number(menuItem.price),
            categoryId: menuItem.categoryId,
            isAvailable: menuItem.isAvailable,
          },
          inventoryItem: null,
          source: 'sku',
        },
      })
    }

    // Step 3: No match found — valid request, just no result
    return NextResponse.json({ data: null })
  } catch (error) {
    console.error('Failed to look up barcode:', error)
    return NextResponse.json({ error: 'Failed to look up barcode' }, { status: 500 })
  }
})
