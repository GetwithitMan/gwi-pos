import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok } from '@/lib/api-response'

// GET — single plan detail
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

    const auth = await requirePermission(employeeId, locationId, 'admin.manage_membership_plans')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "MembershipPlan"
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId)

    if (rows.length === 0) return notFound('Plan not found')
    return ok(rows[0])
  } catch (err) {
    console.error('[membership-plans/[id]] GET error:', err)
    return err('Internal error', 500)
  }
})

// PUT — update plan
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId, name, description, price, billingCycle,
            billingDayOfMonth, billingDayOfWeek, trialDays, setupFee, benefits,
            maxMembers, isActive, sortOrder, currency } = body

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, 'admin.manage_membership_plans')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRawUnsafe(`
      UPDATE "MembershipPlan"
      SET "name" = COALESCE($3, "name"),
          "description" = COALESCE($4, "description"),
          "price" = COALESCE($5, "price"),
          "billingCycle" = COALESCE($6, "billingCycle"),
          "billingDayOfMonth" = COALESCE($7, "billingDayOfMonth"),
          "billingDayOfWeek" = COALESCE($8, "billingDayOfWeek"),
          "trialDays" = COALESCE($9, "trialDays"),
          "setupFee" = COALESCE($10, "setupFee"),
          "benefits" = COALESCE($11, "benefits"),
          "maxMembers" = COALESCE($12, "maxMembers"),
          "isActive" = COALESCE($13, "isActive"),
          "sortOrder" = COALESCE($14, "sortOrder"),
          "currency" = COALESCE($15, "currency"),
          "updatedAt" = NOW()
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      RETURNING *
    `,
      id, locationId, name ?? null, description ?? null, price ?? null,
      billingCycle ?? null, billingDayOfMonth ?? null, billingDayOfWeek ?? null,
      trialDays ?? null, setupFee ?? null,
      benefits ? JSON.stringify(benefits) : null, maxMembers ?? null,
      isActive ?? null, sortOrder ?? null, currency ?? null
    )

    if (rows.length === 0) return notFound('Plan not found')
    return ok(rows[0])
  } catch (err) {
    console.error('[membership-plans/[id]] PUT error:', err)
    return err('Internal error', 500)
  }
})

// DELETE — soft delete
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId')
    const employeeId = sp.get('requestingEmployeeId')

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(employeeId, locationId, 'admin.manage_membership_plans')
    if (!auth.authorized) return err(auth.error, auth.status)

    const rows: any[] = await db.$queryRawUnsafe(`
      UPDATE "MembershipPlan"
      SET "deletedAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      RETURNING "id"
    `, id, locationId)

    if (rows.length === 0) return notFound('Plan not found')
    return ok({ deleted: true })
  } catch (err) {
    console.error('[membership-plans/[id]] DELETE error:', err)
    return err('Internal error', 500)
  }
})
