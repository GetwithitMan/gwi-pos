import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

// GET — list charges for a membership (no admin perm needed — read-only POS query)
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId') || await getLocationId()
    const limit = parseInt(sp.get('limit') || '50')
    const offset = parseInt(sp.get('offset') || '0')

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "MembershipCharge"
      WHERE "membershipId" = $1 AND "locationId" = $2
      ORDER BY "createdAt" DESC
      LIMIT $3 OFFSET $4
    `, id, locationId, limit, offset)

    const countResult: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "total" FROM "MembershipCharge"
      WHERE "membershipId" = $1 AND "locationId" = $2
    `, id, locationId)

    return NextResponse.json({ data: rows, total: countResult[0]?.total ?? 0 })
  } catch (err) {
    console.error('[memberships/charges] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
