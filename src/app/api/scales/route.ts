import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET - List all scales for a location
export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const scales = await db.scale.findMany({
      where: { locationId, deletedAt: null },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      data: scales.map((s) => ({
        ...s,
        maxCapacity: s.maxCapacity ? Number(s.maxCapacity) : null,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch scales:', error)
    return NextResponse.json({ error: 'Failed to fetch scales' }, { status: 500 })
  }
})

const createScaleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  scaleType: z.string().default('CAS_PD_II'),
  portPath: z.string().min(1, 'Port path is required'),
  baudRate: z.number().int().positive().default(9600),
  dataBits: z.number().int().min(5).max(8).default(7),
  parity: z.enum(['none', 'even', 'odd']).default('even'),
  stopBits: z.number().int().min(1).max(2).default(1),
  weightUnit: z.enum(['lb', 'kg', 'oz', 'g']).default('lb'),
  maxCapacity: z.number().positive().optional(),
  precision: z.number().int().min(0).max(6).default(2),
})

// POST - Create a new scale
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = createScaleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: (parsed.error.issues ?? []).map((e: { message: string }) => e.message).join(', ') },
        { status: 400 }
      )
    }

    const { maxCapacity, ...rest } = parsed.data

    const scale = await db.scale.create({
      data: {
        locationId,
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
    console.error('Failed to create scale:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'A scale with this name or port already exists at this location' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to create scale' }, { status: 500 })
  }
})
