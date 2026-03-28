import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get a single prep station
export const GET = withVenue(withAuth('ADMIN', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const station = await db.prepStation.findUnique({
      where: { id },
      include: { categories: { select: { id: true, name: true } } },
    })

    if (!station || station.deletedAt) {
      return notFound('Prep station not found')
    }

    return ok({ station })
  } catch (error) {
    console.error('Failed to fetch prep station:', error)
    return err('Failed to fetch prep station', 500)
  }
}))

// PUT - Update a prep station
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.prepStation.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Prep station not found')
    }

    const station = await db.prepStation.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.displayName !== undefined && { displayName: body.displayName }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.categoryIds !== undefined && {
          categories: { set: body.categoryIds.map((id: string) => ({ id })) },
        }),
      },
      include: { categories: { select: { id: true, name: true } } },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'prep', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({ station })
  } catch (error) {
    console.error('Failed to update prep station:', error)
    return err('Failed to update prep station', 500)
  }
}))

// DELETE - Delete a prep station
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const station = await db.prepStation.findUnique({ where: { id } })
    if (!station || station.deletedAt) {
      return notFound('Prep station not found')
    }

    await db.prepStation.update({ where: { id }, data: { deletedAt: new Date() } })

    void notifyDataChanged({ locationId: station.locationId, domain: 'prep', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete prep station:', error)
    return err('Failed to delete prep station', 500)
  }
}))
