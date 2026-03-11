import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId')
    const employeeId = sp.get('requestingEmployeeId')
    const invoiceNo = sp.get('invoiceNo')
    const datacapRefNo = sp.get('datacapRefNo')

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })
    if (!invoiceNo && !datacapRefNo) {
      return NextResponse.json({ error: 'invoiceNo or datacapRefNo required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    let where = `"mc"."locationId" = $1`
    const params: any[] = [locationId]

    if (invoiceNo) {
      where += ` AND "mc"."invoiceNo" = $2`
      params.push(invoiceNo)
    } else if (datacapRefNo) {
      where += ` AND "mc"."datacapRefNo" = $2`
      params.push(datacapRefNo)
    }

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT "mc".*,
             "m"."customerId", "m"."planId", "m"."status" AS "membershipStatus",
             "p"."name" AS "planName",
             "c"."firstName" AS "customerFirstName", "c"."lastName" AS "customerLastName"
      FROM "MembershipCharge" "mc"
      JOIN "Membership" "m" ON "mc"."membershipId" = "m"."id"
      LEFT JOIN "MembershipPlan" "p" ON "m"."planId" = "p"."id"
      LEFT JOIN "Customer" "c" ON "m"."customerId" = "c"."id"
      WHERE ${where}
      ORDER BY "mc"."createdAt" DESC
      LIMIT 10
    `, ...params)

    return NextResponse.json({ data: rows })
  } catch (err) {
    console.error('[memberships/reconcile] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
