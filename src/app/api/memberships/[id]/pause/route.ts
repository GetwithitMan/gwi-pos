import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { assertStatusTransition } from '@/lib/membership/state-machine'
import { MembershipStatus, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('memberships-pause')

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, resumeDate } = body

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRaw`
      SELECT "id", "status", "customerId" FROM "Membership"
      WHERE "id" = ${id} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      LIMIT 1
    `
    if (rows.length === 0) return notFound('Membership not found')

    const mbr = rows[0]

    try {
      assertStatusTransition(mbr.status as MembershipStatus, MembershipStatus.PAUSED)
    } catch {
      return err(`Cannot pause from status: ${mbr.status}`, 422)
    }

    await db.$executeRaw`
      UPDATE "Membership"
      SET "status" = 'paused', "pausedAt" = NOW(), "nextBillingDate" = NULL,
          "pauseResumeDate" = ${resumeDate ? new Date(resumeDate) : null}, "version" = "version" + 1, "updatedAt" = NOW()
      WHERE "id" = ${id}
    `

    await db.$executeRaw`
      INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
      VALUES (${locationId}, ${id}, ${MembershipEventType.PAUSED}, ${JSON.stringify({ resumeDate: resumeDate || null })}, ${requestingEmployeeId || null})
    `

    void dispatchMembershipUpdate(locationId, {
      action: 'paused', membershipId: id, customerId: mbr.customerId,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ success: true })
  } catch (caughtErr) {
    console.error('[memberships/pause] error:', err)
    return err('Internal error', 500)
  }
})
