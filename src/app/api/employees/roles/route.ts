import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const DEFAULT_LOCATION_ID = 'loc-1'

// GET all roles for a location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId') || DEFAULT_LOCATION_ID

    const roles = await db.role.findMany({
      where: {
        locationId,
        deletedAt: null,
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ roles })
  } catch (error) {
    console.error('Failed to fetch roles:', error)
    return NextResponse.json({ error: 'Failed to fetch roles' }, { status: 500 })
  }
}
