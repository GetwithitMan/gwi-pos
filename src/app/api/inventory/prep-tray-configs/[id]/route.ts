import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET - Get a single tray config
export const GET = withVenue(async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const config = await db.prepTrayConfig.findUnique({
      where: { id },
      include: {
        ingredient: {
          select: { id: true, name: true, standardUnit: true },
        },
      },
    })

    if (!config || config.deletedAt) {
      return notFound('Tray config not found')
    }

    return ok({
        ...config,
        capacity: Number(config.capacity),
      })
  } catch (error) {
    console.error('Get tray config error:', error)
    return err('Failed to fetch tray config', 500)
  }
})

// PUT - Update a tray config
export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, capacity, description, sortOrder, isActive } = body

    const existing = await db.prepTrayConfig.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Tray config not found')
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (capacity !== undefined) updateData.capacity = Number(capacity)
    if (description !== undefined) updateData.description = description
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder
    if (isActive !== undefined) updateData.isActive = isActive

    const config = await db.prepTrayConfig.update({
      where: { id },
      data: updateData,
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'updated', entityId: id })
    pushUpstream()

    return ok({
        ...config,
        capacity: Number(config.capacity),
      })
  } catch (error) {
    console.error('Update tray config error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('A tray config with this name already exists for this prep item')
    }
    return err('Failed to update tray config', 500)
  }
}))

// DELETE - Soft delete a tray config
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const existing = await db.prepTrayConfig.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Tray config not found')
    }

    await db.prepTrayConfig.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'deleted', entityId: id })
    pushUpstream()

    return ok({ message: 'Tray config deleted' })
  } catch (error) {
    console.error('Delete tray config error:', error)
    return err('Failed to delete tray config', 500)
  }
}))
