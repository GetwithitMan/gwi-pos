import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get single storage location
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const storageLocation = await db.storageLocation.findUnique({
      where: { id },
      include: {
        inventoryItems: {
          include: {
            inventoryItem: {
              select: { id: true, name: true, category: true, storageUnit: true },
            },
          },
        },
      },
    })

    if (!storageLocation || storageLocation.deletedAt) {
      return NextResponse.json({ error: 'Storage location not found' }, { status: 404 })
    }

    return NextResponse.json({
      storageLocation: {
        ...storageLocation,
        inventoryItems: storageLocation.inventoryItems.map(item => ({
          ...item,
          currentStock: Number(item.currentStock),
          parLevel: item.parLevel ? Number(item.parLevel) : null,
        })),
      },
    })
  } catch (error) {
    console.error('Get storage location error:', error)
    return NextResponse.json({ error: 'Failed to fetch storage location' }, { status: 500 })
  }
}

// PUT - Update storage location
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.storageLocation.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Storage location not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    const allowedFields = ['name', 'description', 'sortOrder', 'isActive']

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const storageLocation = await db.storageLocation.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ storageLocation })
  } catch (error) {
    console.error('Update storage location error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Storage location with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to update storage location' }, { status: 500 })
  }
}

// DELETE - Soft delete storage location
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.storageLocation.findUnique({
      where: { id },
      include: {
        _count: {
          select: { inventoryItems: true },
        },
      },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Storage location not found' }, { status: 404 })
    }

    if (existing._count.inventoryItems > 0) {
      return NextResponse.json({
        error: 'Cannot delete storage location with assigned items',
      }, { status: 400 })
    }

    await db.storageLocation.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete storage location error:', error)
    return NextResponse.json({ error: 'Failed to delete storage location' }, { status: 500 })
  }
}
