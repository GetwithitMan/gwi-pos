import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { assertStatusTransition } from '@/lib/membership/state-machine'
import { MembershipStatus, MembershipEventType } from '@/lib/membership/types'
import { dispatchMembershipUpdate } from '@/lib/socket-dispatch'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, immediate, reason } = body

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT "id", "status", "currentPeriodEnd", "customerId" FROM "Membership"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId)
    if (rows.length === 0) return NextResponse.json({ error: 'Membership not found' }, { status: 404 })

    const mbr = rows[0]

    try {
      assertStatusTransition(mbr.status as MembershipStatus, MembershipStatus.CANCELLED)
    } catch {
      return NextResponse.json({ error: `Cannot cancel from status: ${mbr.status}` }, { status: 422 })
    }

    if (immediate) {
      await db.$executeRawUnsafe(`
        UPDATE "Membership"
        SET "status" = 'cancelled', "cancelledAt" = NOW(), "endedAt" = NOW(),
            "cancellationReason" = $2, "version" = "version" + 1, "updatedAt" = NOW()
        WHERE "id" = $1
      `, id, reason || null)
    } else {
      // Cancel at end of current period
      await db.$executeRawUnsafe(`
        UPDATE "Membership"
        SET "cancelAtPeriodEnd" = true,
            "cancelEffectiveAt" = "currentPeriodEnd",
            "cancellationReason" = $2,
            "version" = "version" + 1, "updatedAt" = NOW()
        WHERE "id" = $1
      `, id, reason || null)
    }

    await db.$executeRawUnsafe(`
      INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details", "employeeId")
      VALUES ($1, $2, $3, $4, $5)
    `,
      locationId, id, MembershipEventType.CANCELLED,
      JSON.stringify({ immediate: !!immediate, reason: reason || null }),
      requestingEmployeeId || null
    )

    void dispatchMembershipUpdate(locationId, {
      action: 'cancelled', membershipId: id, customerId: mbr.customerId,
    }).catch(console.error)

    return NextResponse.json({ data: { success: true, immediate: !!immediate } })
  } catch (err) {
    console.error('[memberships/cancel] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
