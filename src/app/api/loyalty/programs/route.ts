import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { err, ok } from '@/lib/api-response'

// GET /api/loyalty/programs — list loyalty programs for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
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

    const programs = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT lp.*,
              (SELECT COUNT(*) FROM "Customer" WHERE "loyaltyProgramId" = lp."id" AND "deletedAt" IS NULL)::int AS "enrolledCount",
              (SELECT COUNT(*) FROM "LoyaltyTier" WHERE "programId" = lp."id" AND "deletedAt" IS NULL)::int AS "tierCount"
       FROM "LoyaltyProgram" lp
       WHERE lp."locationId" = ${locationId} AND lp."deletedAt" IS NULL
       ORDER BY lp."createdAt" ASC`

    return ok(programs)
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to list loyalty programs:', error)
    return err('Failed to list loyalty programs', 500)
  }
})

// POST /api/loyalty/programs — create a loyalty program
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
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

    // Check for existing active program
    const existing = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "id" FROM "LoyaltyProgram"
       WHERE "locationId" = ${locationId} AND "deletedAt" IS NULL
       LIMIT 1`

    if (existing.length > 0) {
      return err('Location already has a loyalty program. Edit the existing one.', 409)
    }

    const {
      name = 'Loyalty Program',
      isActive = true,
      pointsPerDollar = 1,
      pointValueCents = 1,
      minimumRedeemPoints = 100,
      roundingMode = 'floor',
      excludedCategoryIds = [],
      excludedItemTypes = [],
    } = body

    if (!['floor', 'round', 'ceil'].includes(roundingMode)) {
      return err('roundingMode must be floor, round, or ceil')
    }

    if (pointsPerDollar < 1) {
      return err('pointsPerDollar must be at least 1')
    }

    const id = crypto.randomUUID()

    await db.$executeRaw`INSERT INTO "LoyaltyProgram" (
        "id", "locationId", "name", "isActive",
        "pointsPerDollar", "pointValueCents", "minimumRedeemPoints",
        "roundingMode", "excludedCategoryIds", "excludedItemTypes",
        "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${locationId}, ${name}, ${isActive},
        ${pointsPerDollar}, ${pointValueCents}, ${minimumRedeemPoints},
        ${roundingMode}, ${excludedCategoryIds}::text[], ${excludedItemTypes}::text[],
        NOW(), NOW()
      )`

    const created = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "LoyaltyProgram" WHERE "id" = ${id}`

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'created', entityId: id })

    return ok(created[0])
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to create loyalty program:', error)
    return err('Failed to create loyalty program', 500)
  }
})
