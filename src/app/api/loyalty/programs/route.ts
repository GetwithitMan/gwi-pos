import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET /api/loyalty/programs — list loyalty programs for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
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

    const programs = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT lp.*,
              (SELECT COUNT(*) FROM "Customer" WHERE "loyaltyProgramId" = lp."id" AND "deletedAt" IS NULL)::int AS "enrolledCount",
              (SELECT COUNT(*) FROM "LoyaltyTier" WHERE "programId" = lp."id" AND "deletedAt" IS NULL)::int AS "tierCount"
       FROM "LoyaltyProgram" lp
       WHERE lp."locationId" = $1 AND lp."deletedAt" IS NULL
       ORDER BY lp."createdAt" ASC`,
      locationId,
    )

    return NextResponse.json({ data: programs })
  } catch (error) {
    console.error('Failed to list loyalty programs:', error)
    return NextResponse.json({ error: 'Failed to list loyalty programs' }, { status: 500 })
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
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // Check for existing active program
    const existing = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id" FROM "LoyaltyProgram"
       WHERE "locationId" = $1 AND "deletedAt" IS NULL
       LIMIT 1`,
      locationId,
    )

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Location already has a loyalty program. Edit the existing one.' },
        { status: 409 },
      )
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
      return NextResponse.json({ error: 'roundingMode must be floor, round, or ceil' }, { status: 400 })
    }

    if (pointsPerDollar < 1) {
      return NextResponse.json({ error: 'pointsPerDollar must be at least 1' }, { status: 400 })
    }

    const id = crypto.randomUUID()

    await db.$executeRawUnsafe(
      `INSERT INTO "LoyaltyProgram" (
        "id", "locationId", "name", "isActive",
        "pointsPerDollar", "pointValueCents", "minimumRedeemPoints",
        "roundingMode", "excludedCategoryIds", "excludedItemTypes",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9::text[], $10::text[],
        NOW(), NOW()
      )`,
      id,
      locationId,
      name,
      isActive,
      pointsPerDollar,
      pointValueCents,
      minimumRedeemPoints,
      roundingMode,
      excludedCategoryIds,
      excludedItemTypes,
    )

    const created = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyProgram" WHERE "id" = $1`,
      id,
    )

    return NextResponse.json({ data: created[0] })
  } catch (error) {
    console.error('Failed to create loyalty program:', error)
    return NextResponse.json({ error: 'Failed to create loyalty program' }, { status: 500 })
  }
})
