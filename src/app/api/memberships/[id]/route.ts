import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok } from '@/lib/api-response'

// GET — membership detail with plan + customer info
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId')
    const employeeId = sp.get('requestingEmployeeId')

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(employeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT "m".*,
             "p"."name" AS "planName", "p"."price" AS "planPrice", "p"."billingCycle" AS "planBillingCycle",
             "p"."benefits" AS "planBenefits", "p"."trialDays" AS "planTrialDays",
             "c"."firstName" AS "customerFirstName", "c"."lastName" AS "customerLastName",
             "c"."email" AS "customerEmail", "c"."phone" AS "customerPhone",
             "sc"."last4" AS "cardLast4", "sc"."cardBrand" AS "cardBrand"
      FROM "Membership" "m"
      LEFT JOIN "MembershipPlan" "p" ON "m"."planId" = "p"."id"
      LEFT JOIN "Customer" "c" ON "m"."customerId" = "c"."id"
      LEFT JOIN "SavedCard" "sc" ON "m"."savedCardId" = "sc"."id"
      WHERE "m"."id" = $1 AND "m"."locationId" = $2 AND "m"."deletedAt" IS NULL
      LIMIT 1
    `, id, locationId)

    if (rows.length === 0) return notFound('Membership not found')
    return ok(rows[0])
  } catch (caughtErr) {
    console.error('[memberships/[id]] GET error:', err)
    return err('Internal error', 500)
  }
})

// DELETE — soft-delete a membership
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId')

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(sp.get('requestingEmployeeId'), locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRawUnsafe(`
      UPDATE "Membership"
      SET "deletedAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      RETURNING "id"
    `, id, locationId)

    if (rows.length === 0) return notFound('Membership not found')
    return ok({ success: true })
  } catch (caughtErr) {
    console.error('[memberships/[id]] DELETE error:', err)
    return err('Internal error', 500)
  }
})

// PUT — update mutable fields (statusReason, notes, etc.)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, statusReason } = body

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_memberships')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRawUnsafe(`
      UPDATE "Membership"
      SET "statusReason" = COALESCE($3, "statusReason"),
          "updatedAt" = NOW()
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      RETURNING *
    `, id, locationId, statusReason ?? null)

    if (rows.length === 0) return notFound('Membership not found')
    return ok(rows[0])
  } catch (caughtErr) {
    console.error('[memberships/[id]] PUT error:', err)
    return err('Internal error', 500)
  }
})
