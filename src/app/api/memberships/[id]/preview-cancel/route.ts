import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok } from '@/lib/api-response'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId } = body

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT "currentPeriodEnd", "status" FROM "Membership"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId)
    if (rows.length === 0) return notFound('Membership not found')

    const mbr = rows[0]
    const now = new Date()
    const periodEnd = mbr.currentPeriodEnd ? new Date(mbr.currentPeriodEnd) : now

    return ok({
        effectiveDate: periodEnd,
        currentPeriodActive: periodEnd > now,
        refundEligible: false, // v1: no refunds on cancel
      })
  } catch (caughtErr) {
    console.error('[memberships/preview-cancel] error:', err)
    return err('Internal error', 500)
  }
})
