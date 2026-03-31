import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { assertStatusTransition } from '@/lib/membership/state-machine'
import { MembershipStatus, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('memberships-resume')

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

    const rows: any[] = await db.$queryRaw`
      SELECT "id", "status", "billingCycle", "customerId" FROM "Membership"
      WHERE "id" = ${id} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      LIMIT 1
    `
    if (rows.length === 0) return notFound('Membership not found')

    const mbr = rows[0]

    try {
      assertStatusTransition(mbr.status as MembershipStatus, MembershipStatus.ACTIVE)
    } catch {
      return err(`Cannot resume from status: ${mbr.status}`, 422)
    }

    // Resume starts a fresh cycle: nextBillingDate = NOW so cron picks it up
    const now = new Date()
    const cycle = mbr.billingCycle || 'monthly'
    const periodEnd = advancePeriod(now, cycle)

    await db.$executeRaw`
      UPDATE "Membership"
      SET "status" = 'active', "pausedAt" = NULL, "pauseResumeDate" = NULL,
          "currentPeriodStart" = ${now}, "currentPeriodEnd" = ${periodEnd},
          "nextBillingDate" = ${now},
          "version" = "version" + 1, "updatedAt" = NOW()
      WHERE "id" = ${id}
    `

    await db.$executeRaw`
      INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
      VALUES (${locationId}, ${id}, ${MembershipEventType.RESUMED}, ${JSON.stringify({ resumedAt: now.toISOString() })}, ${requestingEmployeeId || null})
    `

    void dispatchMembershipUpdate(locationId, {
      action: 'resumed', membershipId: id, customerId: mbr.customerId,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ success: true })
  } catch (caughtErr) {
    console.error('[memberships/resume] error:', err)
    return err('Internal error', 500)
  }
})

function advancePeriod(from: Date, billingCycle: string): Date {
  const d = new Date(from)
  switch (billingCycle) {
    case 'weekly': d.setDate(d.getDate() + 7); break
    case 'annual': d.setFullYear(d.getFullYear() + 1); break
    default: d.setMonth(d.getMonth() + 1); break
  }
  return d
}
