import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'

// GET all roles for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const roles = await db.role.findMany({
      where: {
        locationId,
        deletedAt: null,
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ data: { roles } })
  } catch (error) {
    console.error('Failed to fetch roles:', error)
    return NextResponse.json({ error: 'Failed to fetch roles' }, { status: 500 })
  }
})
