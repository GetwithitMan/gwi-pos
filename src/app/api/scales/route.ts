import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

// GET - List all scales for a location
export const GET = withVenue(withAuth('ADMIN', async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    let scales
    try {
      scales = await db.scale.findMany({
        where: { locationId, deletedAt: null },
        orderBy: { name: 'asc' },
      })
    } catch {
      // Scale table doesn't exist on un-migrated DB — return empty array
      return ok([])
    }

    return ok(scales.map((s) => ({
        ...s,
        maxCapacity: s.maxCapacity ? Number(s.maxCapacity) : null,
      })))
  } catch (error) {
    console.error('Failed to fetch scales:', error)
    return err('Failed to fetch scales', 500)
  }
}))

const createScaleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  scaleType: z.string().default('CAS_PD_II'),
  connectionType: z.enum(['serial', 'network']).default('serial'),
  portPath: z.string().nullable().optional(),
  networkHost: z.string().nullable().optional(),
  networkPort: z.number().int().min(1).max(65535).nullable().optional(),
  baudRate: z.number().int().positive().default(9600),
  dataBits: z.number().int().min(5).max(8).default(7),
  parity: z.enum(['none', 'even', 'odd']).default('even'),
  stopBits: z.number().int().min(1).max(2).default(1),
  weightUnit: z.enum(['lb', 'kg', 'oz', 'g']).default('lb'),
  maxCapacity: z.number().positive().optional(),
  precision: z.number().int().min(0).max(6).default(2),
})

// POST - Create a new scale
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const body = await request.json()
    const parsed = createScaleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: (parsed.error.issues ?? []).map((e: { message: string }) => e.message).join(', ') },
        { status: 400 }
      )
    }

    const { maxCapacity, connectionType, portPath, networkHost, networkPort, ...rest } = parsed.data

    // Validate connection-type-specific fields
    if (connectionType === 'network') {
      if (!networkHost) {
        return err('Host address is required for network connections')
      }
      if (!networkPort) {
        return err('TCP port is required for network connections')
      }
    } else {
      if (!portPath) {
        return err('Port path is required for serial connections')
      }
    }

    let scale
    try {
      scale = await db.scale.create({
        data: {
          locationId,
          connectionType,
          portPath: connectionType === 'serial' ? portPath : null,
          networkHost: connectionType === 'network' ? networkHost : null,
          networkPort: connectionType === 'network' ? networkPort : null,
          ...rest,
          ...(maxCapacity !== undefined && { maxCapacity }),
        },
      })
    } catch (createErr) {
      // Scale table doesn't exist on un-migrated DB
      const msg = createErr instanceof Error ? createErr.message : ''
      if (msg.includes('Unique constraint')) {
        return err('A scale with this name or port already exists at this location')
      }
      console.error('Failed to create scale:', createErr)
      return err('Scale feature not available - database migration required', 500)
    }

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'created', entityId: scale.id })
    void pushUpstream()

    return ok({
        ...scale,
        maxCapacity: scale.maxCapacity ? Number(scale.maxCapacity) : null,
      })
  } catch (error) {
    console.error('Failed to create scale:', error)
    return err('Failed to create scale', 500)
  }
}))
