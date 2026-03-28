import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { err, notFound, ok } from '@/lib/api-response'

// GET /api/loyalty/programs/[id]
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyProgram"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId,
    )

    if (rows.length === 0) {
      return notFound('Program not found')
    }

    // Also fetch tiers
    const tiers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyTier"
       WHERE "programId" = $1 AND "deletedAt" IS NULL
       ORDER BY "sortOrder" ASC`,
      id,
    )

    return ok({ ...rows[0], tiers })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to fetch loyalty program:', error)
    return err('Failed to fetch loyalty program', 500)
  }
})

// PUT /api/loyalty/programs/[id]
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const locationId = actor.locationId || body.locationId

    if (!locationId) {
      return err('locationId is required')
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // Verify exists
    const existing = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id" FROM "LoyaltyProgram"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId,
    )

    if (existing.length === 0) {
      return notFound('Program not found')
    }

    // Build dynamic SET clause
    const setClauses: string[] = ['"updatedAt" = NOW()']
    const setParams: unknown[] = []
    let paramIdx = 1

    const fields: Record<string, { column: string; validate?: (v: unknown) => string | null; isArray?: boolean }> = {
      name: { column: 'name' },
      isActive: { column: 'isActive' },
      pointsPerDollar: { column: 'pointsPerDollar', validate: (v) => (typeof v === 'number' && v >= 1) ? null : 'pointsPerDollar must be >= 1' },
      pointValueCents: { column: 'pointValueCents', validate: (v) => (typeof v === 'number' && v >= 1) ? null : 'pointValueCents must be >= 1' },
      minimumRedeemPoints: { column: 'minimumRedeemPoints', validate: (v) => (typeof v === 'number' && v >= 0) ? null : 'minimumRedeemPoints must be >= 0' },
      roundingMode: { column: 'roundingMode', validate: (v) => ['floor', 'round', 'ceil'].includes(v as string) ? null : 'roundingMode must be floor, round, or ceil' },
      excludedCategoryIds: { column: 'excludedCategoryIds', isArray: true },
      excludedItemTypes: { column: 'excludedItemTypes', isArray: true },
    }

    for (const [key, { column, validate, isArray }] of Object.entries(fields)) {
      if (key in body) {
        if (validate) {
          const validationErr = validate(body[key])
          if (validationErr) return err(validationErr)
        }
        if (isArray) {
          setClauses.push(`"${column}" = $${paramIdx}::text[]`)
        } else {
          setClauses.push(`"${column}" = $${paramIdx}`)
        }
        setParams.push(body[key])
        paramIdx++
      }
    }

    if (setClauses.length === 1) {
      return err('No fields to update')
    }

    setParams.push(id, locationId)

    await db.$executeRawUnsafe(
      `UPDATE "LoyaltyProgram"
       SET ${setClauses.join(', ')}
       WHERE "id" = $${paramIdx} AND "locationId" = $${paramIdx + 1} AND "deletedAt" IS NULL`,
      ...setParams,
    )

    const updated = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyProgram" WHERE "id" = $1`,
      id,
    )

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'updated', entityId: id })

    return ok(updated[0])
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to update loyalty program:', error)
    return err('Failed to update loyalty program', 500)
  }
})

// DELETE /api/loyalty/programs/[id] — soft delete
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    const result = await db.$executeRawUnsafe(
      `UPDATE "LoyaltyProgram"
       SET "deletedAt" = NOW(), "updatedAt" = NOW(), "isActive" = false
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId,
    )

    if (result === 0) {
      return notFound('Program not found')
    }

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'deleted', entityId: id })

    return ok({ success: true })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to delete loyalty program:', error)
    return err('Failed to delete loyalty program', 500)
  }
})
