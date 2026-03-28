import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { emitToLocation } from '@/lib/socket-server'
import { withAuth } from '@/lib/api-auth-middleware'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('location')

export const GET = withVenue(async function GET() {
  try {
    const location = await db.location.findFirst({
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        timezone: true,
      },
    })

    if (!location) {
      return notFound('No location found')
    }

    return ok(location)
  } catch (error) {
    console.error('Failed to fetch location:', error)
    return err('Failed to fetch location', 500)
  }
})

export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, address, phone, timezone } = body

    const location = await db.location.findFirst()
    if (!location) {
      return notFound('No location found')
    }

    const updateData: Record<string, string | null> = {}
    if (name !== undefined) updateData.name = name
    if (address !== undefined) updateData.address = address || null
    if (phone !== undefined) updateData.phone = phone || null
    if (timezone !== undefined) updateData.timezone = timezone

    const updated = await db.location.update({
      where: { id: location.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        timezone: true,
      },
    })

    void notifyDataChanged({ locationId: location.id, domain: 'location', action: 'updated' })
    void pushUpstream()
    void emitToLocation(location.id, 'settings:updated', { trigger: 'location-metadata-changed' }).catch(err => log.warn({ err }, 'socket emit failed'))

    return ok(updated)
  } catch (error) {
    console.error('Failed to update location:', error)
    return err('Failed to update location', 500)
  }
}))
