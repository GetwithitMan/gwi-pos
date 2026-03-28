import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// GET all roles for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return err('locationId is required')
    }

    const roles = await db.role.findMany({
      where: {
        locationId,
        deletedAt: null,
      },
      orderBy: { name: 'asc' },
    })

    return ok({ roles })
  } catch (error) {
    console.error('Failed to fetch roles:', error)
    return err('Failed to fetch roles', 500)
  }
})
