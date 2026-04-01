import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { err } from '@/lib/api-response'

// GET — list charges for a membership (no admin perm needed — read-only POS query)
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId') || await getLocationId()
    const limit = Math.max(1, Math.min(parseInt(sp.get('limit') || '50', 10) || 50, 500))
    const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0)

    if (!locationId) return err('locationId required')

    const rows: any[] = await db.$queryRaw`
      SELECT * FROM "MembershipCharge"
      WHERE "membershipId" = ${id} AND "locationId" = ${locationId}
      ORDER BY "createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const countResult: any[] = await db.$queryRaw`
      SELECT COUNT(*)::int AS "total" FROM "MembershipCharge"
      WHERE "membershipId" = ${id} AND "locationId" = ${locationId}
    `

    return NextResponse.json({ data: rows, total: countResult[0]?.total ?? 0 })
  } catch (caughtErr) {
    console.error('[memberships/charges] error:', err)
    return err('Internal error', 500)
  }
})
