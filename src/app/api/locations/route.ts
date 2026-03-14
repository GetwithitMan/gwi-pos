import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List all locations (optionally scoped to same organization as locationId)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    // If a locationId is provided, scope results to the same organization
    let orgFilter: Record<string, unknown> = {}
    if (locationId) {
      const loc = await db.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      })
      if (loc) {
        orgFilter = { organizationId: loc.organizationId }
      }
    }

    const locations = await db.location.findMany({
      where: { isActive: true, deletedAt: null, ...orgFilter },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        isActive: true,
        timezone: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ data: { locations } })
  } catch (error) {
    console.error('[locations] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch locations' },
      { status: 500 }
    )
  }
})
