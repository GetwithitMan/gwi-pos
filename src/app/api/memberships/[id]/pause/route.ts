import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { assertStatusTransition } from '@/lib/membership/state-machine'
import { MembershipStatus, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('memberships-pause')

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, resumeDate } = body

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT "id", "status", "customerId" FROM "Membership"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId)
    if (rows.length === 0) return NextResponse.json({ error: 'Membership not found' }, { status: 404 })

    const mbr = rows[0]

    try {
      assertStatusTransition(mbr.status as MembershipStatus, MembershipStatus.PAUSED)
    } catch {
      return NextResponse.json({ error: `Cannot pause from status: ${mbr.status}` }, { status: 422 })
    }

    await db.$executeRawUnsafe(`
      UPDATE "Membership"
      SET "status" = 'paused', "pausedAt" = NOW(), "nextBillingDate" = NULL,
          "pauseResumeDate" = $2, "version" = "version" + 1, "updatedAt" = NOW()
      WHERE "id" = $1
    `, id, resumeDate ? new Date(resumeDate) : null)

    await db.$executeRawUnsafe(`
      INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
      VALUES ($1, $2, $3, $4, $5)
    `,
      locationId, id, MembershipEventType.PAUSED,
      JSON.stringify({ resumeDate: resumeDate || null }),
      requestingEmployeeId || null
    )

    void dispatchMembershipUpdate(locationId, {
      action: 'paused', membershipId: id, customerId: mbr.customerId,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({ data: { success: true } })
  } catch (err) {
    console.error('[memberships/pause] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
