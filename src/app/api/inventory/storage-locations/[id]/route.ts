import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get single storage location
export const GET = withVenue(async function GET(
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
      return notFound('Storage location not found')
    }

    return ok({
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
    return err('Failed to fetch storage location', 500)
  }
})

// PUT - Update storage location
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
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
      return notFound('Storage location not found')
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

    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({ storageLocation })
  } catch (error) {
    console.error('Update storage location error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('Storage location with this name already exists')
    }
    return err('Failed to update storage location', 500)
  }
}))

// DELETE - Soft delete storage location
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
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
      return notFound('Storage location not found')
    }

    if (existing._count.inventoryItems > 0) {
      return err('Cannot delete storage location with assigned items')
    }

    await db.storageLocation.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Delete storage location error:', error)
    return err('Failed to delete storage location', 500)
  }
}))
