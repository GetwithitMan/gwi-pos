import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'

// GET - Get single scale by ID
export const GET = withVenue(async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    let scale
    try {
      scale = await db.scale.findFirst({
        where: { id, locationId, deletedAt: null },
      })
    } catch {
      // Scale table doesn't exist on un-migrated DB
      return NextResponse.json(
        { error: 'Scale feature not available - database migration required' },
        { status: 503 }
      )
    }

    if (!scale) {
      return NextResponse.json({ error: 'Scale not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        ...scale,
        maxCapacity: scale.maxCapacity ? Number(scale.maxCapacity) : null,
      },
    })
  } catch (error) {
    console.error('Failed to fetch scale:', error)
    return NextResponse.json({ error: 'Failed to fetch scale' }, { status: 500 })
  }
})

const updateScaleSchema = z.object({
  name: z.string().min(1).optional(),
  scaleType: z.string().optional(),
  connectionType: z.enum(['serial', 'network']).optional(),
  portPath: z.string().nullable().optional(),
  networkHost: z.string().nullable().optional(),
  networkPort: z.number().int().min(1).max(65535).nullable().optional(),
  baudRate: z.number().int().positive().optional(),
  dataBits: z.number().int().min(5).max(8).optional(),
  parity: z.enum(['none', 'even', 'odd']).optional(),
  stopBits: z.number().int().min(1).max(2).optional(),
  weightUnit: z.enum(['lb', 'kg', 'oz', 'g']).optional(),
  maxCapacity: z.number().positive().nullable().optional(),
  precision: z.number().int().min(0).max(6).optional(),
  isActive: z.boolean().optional(),
}).strict()

// PUT - Update scale
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    let existing
    try {
      existing = await db.scale.findFirst({
        where: { id, locationId, deletedAt: null },
      })
    } catch {
      // Scale table doesn't exist on un-migrated DB
      return NextResponse.json(
        { error: 'Scale feature not available - database migration required' },
        { status: 503 }
      )
    }
    if (!existing) {
      return NextResponse.json({ error: 'Scale not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = updateScaleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: (parsed.error.issues ?? []).map((e: { message: string }) => e.message).join(', ') },
        { status: 400 }
      )
    }

    const { maxCapacity, connectionType, portPath, networkHost, networkPort, ...rest } = parsed.data

    // Determine effective connection type (use incoming or fall back to existing)
    const effectiveConnectionType = connectionType ?? existing.connectionType ?? 'serial'

    // Validate connection-type-specific fields when connection type is being set or changed
    if (connectionType !== undefined || portPath !== undefined || networkHost !== undefined || networkPort !== undefined) {
      if (effectiveConnectionType === 'network') {
        const effectiveHost = networkHost !== undefined ? networkHost : existing.networkHost
        const effectivePort = networkPort !== undefined ? networkPort : existing.networkPort
        if (!effectiveHost) {
          return NextResponse.json({ error: 'Host address is required for network connections' }, { status: 400 })
        }
        if (!effectivePort) {
          return NextResponse.json({ error: 'TCP port is required for network connections' }, { status: 400 })
        }
      } else {
        const effectivePath = portPath !== undefined ? portPath : existing.portPath
        if (!effectivePath) {
          return NextResponse.json({ error: 'Port path is required for serial connections' }, { status: 400 })
        }
      }
    }

    const scale = await db.scale.update({
      where: { id },
      data: {
        ...rest,
        ...(connectionType !== undefined && { connectionType }),
        ...(portPath !== undefined && { portPath }),
        ...(networkHost !== undefined && { networkHost }),
        ...(networkPort !== undefined && { networkPort }),
        ...(maxCapacity !== undefined && { maxCapacity }),
      },
    })

    void notifyDataChanged({ locationId: locationId!, domain: 'hardware', action: 'updated', entityId: id })

    return NextResponse.json({
      data: {
        ...scale,
        maxCapacity: scale.maxCapacity ? Number(scale.maxCapacity) : null,
      },
    })
  } catch (error) {
    console.error('Failed to update scale:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'A scale with this name or port already exists at this location' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to update scale' }, { status: 500 })
  }
})

// DELETE - Soft delete scale
export const DELETE = withVenue(async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    let existing
    try {
      existing = await db.scale.findFirst({
        where: { id, locationId, deletedAt: null },
      })
    } catch {
      // Scale table doesn't exist on un-migrated DB
      return NextResponse.json(
        { error: 'Scale feature not available - database migration required' },
        { status: 503 }
      )
    }
    if (!existing) {
      return NextResponse.json({ error: 'Scale not found' }, { status: 404 })
    }

    await db.scale.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: locationId!, domain: 'hardware', action: 'deleted', entityId: id })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete scale:', error)
    return NextResponse.json({ error: 'Failed to delete scale' }, { status: 500 })
  }
})
