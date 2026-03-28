import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get single void reason
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const voidReason = await db.voidReason.findUnique({
      where: { id },
    })

    if (!voidReason || voidReason.deletedAt) {
      return notFound('Void reason not found')
    }

    return ok({ voidReason })
  } catch (error) {
    console.error('Get void reason error:', error)
    return err('Failed to fetch void reason', 500)
  }
})

// PUT - Update void reason
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.voidReason.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return notFound('Void reason not found')
    }

    const updateData: Record<string, unknown> = {}
    const allowedFields = ['name', 'description', 'deductInventory', 'requiresManager', 'sortOrder', 'isActive']

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const voidReason = await db.voidReason.update({
      where: { id },
      data: updateData,
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'reasons', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({ voidReason })
  } catch (error) {
    console.error('Update void reason error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('Void reason with this name already exists')
    }
    return err('Failed to update void reason', 500)
  }
}))

// DELETE - Soft delete void reason
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.voidReason.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return notFound('Void reason not found')
    }

    await db.voidReason.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'reasons', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Delete void reason error:', error)
    return err('Failed to delete void reason', 500)
  }
}))
