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

    const rows: any[] = await db.$queryRaw`
      SELECT * FROM "MembershipPlan"
      WHERE "id" = ${id} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      LIMIT 1
    `

    if (rows.length === 0) return notFound('Plan not found')
    return ok(rows[0])
  } catch (caughtErr) {
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

    const rows: any[] = await db.$queryRaw`
      UPDATE "MembershipPlan"
      SET "name" = COALESCE(${name ?? null}, "name"),
          "description" = COALESCE(${description ?? null}, "description"),
          "price" = COALESCE(${price ?? null}, "price"),
          "billingCycle" = COALESCE(${billingCycle ?? null}, "billingCycle"),
          "billingDayOfMonth" = COALESCE(${billingDayOfMonth ?? null}, "billingDayOfMonth"),
          "billingDayOfWeek" = COALESCE(${billingDayOfWeek ?? null}, "billingDayOfWeek"),
          "trialDays" = COALESCE(${trialDays ?? null}, "trialDays"),
          "setupFee" = COALESCE(${setupFee ?? null}, "setupFee"),
          "benefits" = COALESCE(${benefits ? JSON.stringify(benefits) : null}, "benefits"),
          "maxMembers" = COALESCE(${maxMembers ?? null}, "maxMembers"),
          "isActive" = COALESCE(${isActive ?? null}, "isActive"),
          "sortOrder" = COALESCE(${sortOrder ?? null}, "sortOrder"),
          "currency" = COALESCE(${currency ?? null}, "currency"),
          "updatedAt" = NOW()
      WHERE "id" = ${id} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      RETURNING *
    `

    if (rows.length === 0) return notFound('Plan not found')
    return ok(rows[0])
  } catch (caughtErr) {
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

    const rows: any[] = await db.$queryRaw`
      UPDATE "MembershipPlan"
      SET "deletedAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = ${id} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      RETURNING "id"
    `

    if (rows.length === 0) return notFound('Plan not found')
    return ok({ deleted: true })
  } catch (caughtErr) {
    console.error('[membership-plans/[id]] DELETE error:', err)
    return err('Internal error', 500)
  }
})
