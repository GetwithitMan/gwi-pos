import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get single comp reason
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const compReason = await db.compReason.findUnique({
      where: { id },
    })

    if (!compReason || compReason.deletedAt) {
      return notFound('Comp reason not found')
    }

    return ok({ compReason })
  } catch (error) {
    console.error('Get comp reason error:', error)
    return err('Failed to fetch comp reason', 500)
  }
})

// PUT - Update comp reason
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.compReason.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return notFound('Comp reason not found')
    }

    const updateData: Record<string, unknown> = {}
    const allowedFields = ['name', 'description', 'deductInventory', 'requiresManager', 'sortOrder', 'isActive']

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const compReason = await db.compReason.update({
      where: { id },
      data: updateData,
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'reasons', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({ compReason })
  } catch (error) {
    console.error('Update comp reason error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('Comp reason with this name already exists')
    }
    return err('Failed to update comp reason', 500)
  }
}))

// DELETE - Soft delete comp reason
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.compReason.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return notFound('Comp reason not found')
    }

    await db.compReason.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'reasons', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Delete comp reason error:', error)
    return err('Failed to delete comp reason', 500)
  }
}))
