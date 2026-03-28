import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { err, notFound, ok } from '@/lib/api-response'

// GET /api/loyalty/tiers — list tiers for a program
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const programId = searchParams.get('programId')

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

    let tiers: Array<Record<string, unknown>>

    if (programId) {
      tiers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT lt.*,
                (SELECT COUNT(*) FROM "Customer" WHERE "loyaltyTierId" = lt."id" AND "deletedAt" IS NULL)::int AS "customerCount"
         FROM "LoyaltyTier" lt
         WHERE lt."programId" = $1 AND lt."deletedAt" IS NULL
         ORDER BY lt."sortOrder" ASC`,
        programId,
      )
    } else {
      // Find all tiers for programs at this location
      tiers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT lt.*,
                (SELECT COUNT(*) FROM "Customer" WHERE "loyaltyTierId" = lt."id" AND "deletedAt" IS NULL)::int AS "customerCount"
         FROM "LoyaltyTier" lt
         JOIN "LoyaltyProgram" lp ON lp."id" = lt."programId"
         WHERE lp."locationId" = $1 AND lt."deletedAt" IS NULL AND lp."deletedAt" IS NULL
         ORDER BY lt."sortOrder" ASC`,
        locationId,
      )
    }

    return ok(tiers)
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to list loyalty tiers:', error)
    return err('Failed to list loyalty tiers', 500)
  }
})

// POST /api/loyalty/tiers — create a tier
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

    const { programId, name, minimumPoints = 0, pointsMultiplier = 1.0, perks = {}, color = '#6366f1', sortOrder = 0 } = body

    if (!programId) {
      return err('programId is required')
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return err('name is required')
    }

    // Verify program belongs to location
    const program = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id" FROM "LoyaltyProgram"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      programId,
      locationId,
    )
    if (program.length === 0) {
      return notFound('Program not found at this location')
    }

    const id = crypto.randomUUID()

    await db.$executeRawUnsafe(
      `INSERT INTO "LoyaltyTier" (
        "id", "programId", "name", "minimumPoints",
        "pointsMultiplier", "perks", "color", "sortOrder",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6::jsonb, $7, $8,
        NOW(), NOW()
      )`,
      id,
      programId,
      name.trim(),
      minimumPoints,
      pointsMultiplier,
      JSON.stringify(perks),
      color,
      sortOrder,
    )

    const created = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyTier" WHERE "id" = $1`,
      id,
    )

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'created', entityId: id })

    return ok(created[0])
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to create loyalty tier:', error)
    return err('Failed to create loyalty tier', 500)
  }
})
