import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET — Get single barcode by ID
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const barcode = await db.itemBarcode.findFirst({
      where: { id, deletedAt: null },
      include: {
        menuItem: { select: { id: true, name: true, price: true } },
        inventoryItem: { select: { id: true, name: true, currentStock: true } },
      },
    })

    if (!barcode) {
      return NextResponse.json({ error: 'Barcode not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: barcode.id,
        barcode: barcode.barcode,
        label: barcode.label,
        packSize: barcode.packSize,
        price: barcode.price ? Number(barcode.price) : null,
        menuItemId: barcode.menuItemId,
        menuItem: barcode.menuItem ? {
          id: barcode.menuItem.id,
          name: barcode.menuItem.name,
          price: Number(barcode.menuItem.price),
        } : null,
        inventoryItemId: barcode.inventoryItemId,
        inventoryItem: barcode.inventoryItem ? {
          id: barcode.inventoryItem.id,
          name: barcode.inventoryItem.name,
          currentStock: Number(barcode.inventoryItem.currentStock),
        } : null,
        createdAt: barcode.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to fetch barcode:', error)
    return NextResponse.json({ error: 'Failed to fetch barcode' }, { status: 500 })
  }
})

// PUT — Update barcode
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { barcode, label, packSize, price, menuItemId, inventoryItemId } = body

    // Verify record exists
    const existing = await db.itemBarcode.findFirst({
      where: { id, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Barcode not found' }, { status: 404 })
    }

    // If barcode value is changing, check for duplicates
    if (barcode !== undefined && barcode.trim() !== existing.barcode) {
      const duplicate = await db.itemBarcode.findFirst({
        where: {
          locationId: existing.locationId,
          barcode: barcode.trim(),
          deletedAt: null,
          id: { not: id },
        },
      })
      if (duplicate) {
        return NextResponse.json(
          { error: 'A barcode with this value already exists at this location' },
          { status: 409 }
        )
      }
    }

    const data: Record<string, unknown> = {}
    if (barcode !== undefined) data.barcode = barcode.trim()
    if (label !== undefined) data.label = label || null
    if (packSize !== undefined) data.packSize = packSize
    if (price !== undefined) data.price = price
    if (menuItemId !== undefined) data.menuItemId = menuItemId || null
    if (inventoryItemId !== undefined) data.inventoryItemId = inventoryItemId || null

    const updated = await db.itemBarcode.update({
      where: { id },
      data,
      include: {
        menuItem: { select: { id: true, name: true, price: true } },
        inventoryItem: { select: { id: true, name: true, currentStock: true } },
      },
    })

    pushUpstream()

    return NextResponse.json({
      data: {
        id: updated.id,
        barcode: updated.barcode,
        label: updated.label,
        packSize: updated.packSize,
        price: updated.price ? Number(updated.price) : null,
        menuItemId: updated.menuItemId,
        menuItem: updated.menuItem ? {
          id: updated.menuItem.id,
          name: updated.menuItem.name,
          price: Number(updated.menuItem.price),
        } : null,
        inventoryItemId: updated.inventoryItemId,
        inventoryItem: updated.inventoryItem ? {
          id: updated.inventoryItem.id,
          name: updated.inventoryItem.name,
          currentStock: Number(updated.inventoryItem.currentStock),
        } : null,
        createdAt: updated.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to update barcode:', error)
    return NextResponse.json({ error: 'Failed to update barcode' }, { status: 500 })
  }
}))

// DELETE — Soft-delete barcode
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.itemBarcode.findFirst({
      where: { id, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Barcode not found' }, { status: 404 })
    }

    await db.itemBarcode.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    pushUpstream()

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete barcode:', error)
    return NextResponse.json({ error: 'Failed to delete barcode' }, { status: 500 })
  }
}))
