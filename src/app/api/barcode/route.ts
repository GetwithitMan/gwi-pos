import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

// GET — List barcodes for a menu item or inventory item
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId') || await getLocationId()
    const menuItemId = searchParams.get('menuItemId')
    const inventoryItemId = searchParams.get('inventoryItemId')
    const search = searchParams.get('search')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (menuItemId) where.menuItemId = menuItemId
    if (inventoryItemId) where.inventoryItemId = inventoryItemId
    if (search) where.barcode = { contains: search }

    const barcodes = await db.itemBarcode.findMany({
      where,
      include: {
        menuItem: { select: { id: true, name: true, price: true } },
        inventoryItem: { select: { id: true, name: true, currentStock: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      data: barcodes.map(b => ({
        id: b.id,
        barcode: b.barcode,
        label: b.label,
        packSize: b.packSize,
        price: b.price ? Number(b.price) : null,
        menuItemId: b.menuItemId,
        menuItem: b.menuItem ? {
          id: b.menuItem.id,
          name: b.menuItem.name,
          price: Number(b.menuItem.price),
        } : null,
        inventoryItemId: b.inventoryItemId,
        inventoryItem: b.inventoryItem ? {
          id: b.inventoryItem.id,
          name: b.inventoryItem.name,
          currentStock: Number(b.inventoryItem.currentStock),
        } : null,
        createdAt: b.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to list barcodes:', error)
    return NextResponse.json({ error: 'Failed to list barcodes' }, { status: 500 })
  }
})

// POST — Create a new barcode mapping
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId: bodyLocationId, barcode, label, packSize, price, menuItemId, inventoryItemId } = body

    const locationId = bodyLocationId || await getLocationId()

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    if (!barcode) {
      return NextResponse.json({ error: 'Barcode is required' }, { status: 400 })
    }

    if (!menuItemId && !inventoryItemId) {
      return NextResponse.json(
        { error: 'At least one of menuItemId or inventoryItemId is required' },
        { status: 400 }
      )
    }

    const trimmedBarcode = barcode.trim()

    // Check for duplicate barcode at this location
    const existing = await db.itemBarcode.findFirst({
      where: { locationId, barcode: trimmedBarcode, deletedAt: null },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'A barcode with this value already exists at this location' },
        { status: 409 }
      )
    }

    const created = await db.itemBarcode.create({
      data: {
        locationId,
        barcode: trimmedBarcode,
        label: label || null,
        packSize: packSize || 1,
        price: price ?? null,
        menuItemId: menuItemId || null,
        inventoryItemId: inventoryItemId || null,
      },
      include: {
        menuItem: { select: { id: true, name: true, price: true } },
        inventoryItem: { select: { id: true, name: true, currentStock: true } },
      },
    })

    return NextResponse.json({
      data: {
        id: created.id,
        barcode: created.barcode,
        label: created.label,
        packSize: created.packSize,
        price: created.price ? Number(created.price) : null,
        menuItemId: created.menuItemId,
        menuItem: created.menuItem ? {
          id: created.menuItem.id,
          name: created.menuItem.name,
          price: Number(created.menuItem.price),
        } : null,
        inventoryItemId: created.inventoryItemId,
        inventoryItem: created.inventoryItem ? {
          id: created.inventoryItem.id,
          name: created.inventoryItem.name,
          currentStock: Number(created.inventoryItem.currentStock),
        } : null,
        createdAt: created.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to create barcode:', error)
    return NextResponse.json({ error: 'Failed to create barcode' }, { status: 500 })
  }
})
