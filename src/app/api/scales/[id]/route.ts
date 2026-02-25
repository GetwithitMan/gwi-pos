import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

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

    const scale = await db.scale.findFirst({
      where: { id, locationId, deletedAt: null },
    })

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
  portPath: z.string().min(1).optional(),
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

    const existing = await db.scale.findFirst({
      where: { id, locationId, deletedAt: null },
    })
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

    const { maxCapacity, ...rest } = parsed.data

    const scale = await db.scale.update({
      where: { id },
      data: {
        ...rest,
        ...(maxCapacity !== undefined && { maxCapacity }),
      },
    })

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

    const existing = await db.scale.findFirst({
      where: { id, locationId, deletedAt: null },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Scale not found' }, { status: 404 })
    }

    await db.scale.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete scale:', error)
    return NextResponse.json({ error: 'Failed to delete scale' }, { status: 500 })
  }
})
