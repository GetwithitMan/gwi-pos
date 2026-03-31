import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { assertStatusTransition } from '@/lib/membership/state-machine'
import { MembershipStatus, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('memberships-cancel')

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, immediate, reason } = body

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRaw`
      SELECT "id", "status", "currentPeriodEnd", "customerId" FROM "Membership"
      WHERE "id" = ${id} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      LIMIT 1
    `
    if (rows.length === 0) return notFound('Membership not found')

    const mbr = rows[0]

    try {
      assertStatusTransition(mbr.status as MembershipStatus, MembershipStatus.CANCELLED)
    } catch {
      return err(`Cannot cancel from status: ${mbr.status}`, 422)
    }

    if (immediate) {
      await db.$executeRaw`
        UPDATE "Membership"
        SET "status" = 'cancelled', "cancelledAt" = NOW(), "endedAt" = NOW(),
            "cancellationReason" = ${reason || null}, "version" = "version" + 1, "updatedAt" = NOW()
        WHERE "id" = ${id}
      `
    } else {
      // Cancel at end of current period
      await db.$executeRaw`
        UPDATE "Membership"
        SET "cancelAtPeriodEnd" = true,
            "cancelEffectiveAt" = "currentPeriodEnd",
            "cancellationReason" = ${reason || null},
            "version" = "version" + 1, "updatedAt" = NOW()
        WHERE "id" = ${id}
      `
    }

    await db.$executeRaw`
      INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
      VALUES (${locationId}, ${id}, ${MembershipEventType.CANCELLED}, ${JSON.stringify({ immediate: !!immediate, reason: reason || null })}, ${requestingEmployeeId || null})
    `

    void dispatchMembershipUpdate(locationId, {
      action: 'cancelled', membershipId: id, customerId: mbr.customerId,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ success: true, immediate: !!immediate })
  } catch (caughtErr) {
    console.error('[memberships/cancel] error:', err)
    return err('Internal error', 500)
  }
})
