import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { err } from '@/lib/api-response'

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId')
    const employeeId = sp.get('requestingEmployeeId')
    const limit = parseInt(sp.get('limit') || '50')
    const offset = parseInt(sp.get('offset') || '0')

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(employeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "MembershipEvent"
      WHERE "membershipId" = $1 AND "locationId" = $2
      ORDER BY "createdAt" DESC
      LIMIT $3 OFFSET $4
    `, id, locationId, limit, offset)

    const countResult: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "total" FROM "MembershipEvent"
      WHERE "membershipId" = $1 AND "locationId" = $2
    `, id, locationId)

    return NextResponse.json({ data: rows, total: countResult[0]?.total ?? 0 })
  } catch (caughtErr) {
    console.error('[memberships/events] error:', err)
    return err('Internal error', 500)
  }
})
