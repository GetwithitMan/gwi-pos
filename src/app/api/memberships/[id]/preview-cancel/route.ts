import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId } = body

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT "currentPeriodEnd", "status" FROM "Membership"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId)
    if (rows.length === 0) return NextResponse.json({ error: 'Membership not found' }, { status: 404 })

    const mbr = rows[0]
    const now = new Date()
    const periodEnd = mbr.currentPeriodEnd ? new Date(mbr.currentPeriodEnd) : now

    return NextResponse.json({
      data: {
        effectiveDate: periodEnd,
        currentPeriodActive: periodEnd > now,
        refundEligible: false, // v1: no refunds on cancel
      },
    })
  } catch (err) {
    console.error('[memberships/preview-cancel] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
