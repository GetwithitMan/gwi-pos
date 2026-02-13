import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

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
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    return NextResponse.json({ data: location })
  } catch (error) {
    console.error('Failed to fetch location:', error)
    return NextResponse.json({ error: 'Failed to fetch location' }, { status: 500 })
  }
})

export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, address, phone, timezone } = body

    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
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

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('Failed to update location:', error)
    return NextResponse.json({ error: 'Failed to update location' }, { status: 500 })
  }
})
