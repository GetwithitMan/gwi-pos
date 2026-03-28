import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { err, notFound, ok } from '@/lib/api-response'

// GET /api/loyalty/tiers/[id]
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
      `SELECT lt.* FROM "LoyaltyTier" lt
       JOIN "LoyaltyProgram" lp ON lp."id" = lt."programId"
       WHERE lt."id" = $1 AND lp."locationId" = $2 AND lt."deletedAt" IS NULL`,
      id,
      locationId,
    )

    if (rows.length === 0) {
      return notFound('Tier not found')
    }

    return ok(rows[0])
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to fetch loyalty tier:', error)
    return err('Failed to fetch loyalty tier', 500)
  }
})

// PUT /api/loyalty/tiers/[id]
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

    // Verify tier belongs to location
    const existing = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT lt."id" FROM "LoyaltyTier" lt
       JOIN "LoyaltyProgram" lp ON lp."id" = lt."programId"
       WHERE lt."id" = $1 AND lp."locationId" = $2 AND lt."deletedAt" IS NULL`,
      id,
      locationId,
    )

    if (existing.length === 0) {
      return notFound('Tier not found')
    }

    const setClauses: string[] = ['"updatedAt" = NOW()']
    const setParams: unknown[] = []
    let paramIdx = 1

    const fields: Record<string, { column: string; jsonb?: boolean }> = {
      name: { column: 'name' },
      minimumPoints: { column: 'minimumPoints' },
      pointsMultiplier: { column: 'pointsMultiplier' },
      perks: { column: 'perks', jsonb: true },
      color: { column: 'color' },
      sortOrder: { column: 'sortOrder' },
    }

    for (const [key, { column, jsonb }] of Object.entries(fields)) {
      if (key in body) {
        if (jsonb) {
          setClauses.push(`"${column}" = $${paramIdx}::jsonb`)
          setParams.push(JSON.stringify(body[key]))
        } else {
          setClauses.push(`"${column}" = $${paramIdx}`)
          setParams.push(body[key])
        }
        paramIdx++
      }
    }

    if (setClauses.length === 1) {
      return err('No fields to update')
    }

    setParams.push(id)

    await db.$executeRawUnsafe(
      `UPDATE "LoyaltyTier"
       SET ${setClauses.join(', ')}
       WHERE "id" = $${paramIdx} AND "deletedAt" IS NULL`,
      ...setParams,
    )

    const updated = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyTier" WHERE "id" = $1`,
      id,
    )

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'updated', entityId: id })

    return ok(updated[0])
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to update loyalty tier:', error)
    return err('Failed to update loyalty tier', 500)
  }
})

// DELETE /api/loyalty/tiers/[id] — soft delete
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

    // Verify tier belongs to location
    const existing = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT lt."id" FROM "LoyaltyTier" lt
       JOIN "LoyaltyProgram" lp ON lp."id" = lt."programId"
       WHERE lt."id" = $1 AND lp."locationId" = $2 AND lt."deletedAt" IS NULL`,
      id,
      locationId,
    )

    if (existing.length === 0) {
      return notFound('Tier not found')
    }

    // Unlink customers from this tier (scoped to location)
    await db.$executeRawUnsafe(
      `UPDATE "Customer" SET "loyaltyTierId" = NULL, "updatedAt" = NOW()
       WHERE "loyaltyTierId" = $1 AND "locationId" = $2`,
      id,
      locationId,
    )

    await db.$executeRawUnsafe(
      `UPDATE "LoyaltyTier"
       SET "deletedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = $1`,
      id,
    )

    pushUpstream()
    void notifyDataChanged({ locationId: locationId!, domain: 'loyalty', action: 'deleted', entityId: id })

    return ok({ success: true })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to delete loyalty tier:', error)
    return err('Failed to delete loyalty tier', 500)
  }
})
