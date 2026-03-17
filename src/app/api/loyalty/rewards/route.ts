import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

const VALID_REWARD_TYPES = ['free_item', 'discount_percent', 'discount_fixed', 'free_delivery', 'custom']

// GET /api/loyalty/rewards — list rewards for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // ── Permission check ──────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.CAKE_SETTINGS)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Build query ─────────────────────────────────────────────────
    const conditions: string[] = ['"locationId" = $1', '"deletedAt" IS NULL']
    const params: unknown[] = [locationId]
    let paramIdx = 2

    const isActive = searchParams.get('isActive')
    if (isActive !== null) {
      conditions.push(`"isActive" = $${paramIdx}`)
      params.push(isActive === 'true')
      paramIdx++
    }

    const whereClause = conditions.join(' AND ')

    const rewards = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyReward"
       WHERE ${whereClause}
       ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      ...params,
    )

    return NextResponse.json({ data: rewards })
  } catch (error) {
    console.error('Failed to list loyalty rewards:', error)
    return NextResponse.json({ error: 'Failed to list loyalty rewards' }, { status: 500 })
  }
})

// POST /api/loyalty/rewards — create a reward
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // ── Resolve actor ─────────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const locationId = actor.locationId || body.locationId

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // ── Permission check ──────────────────────────────────────────────
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.CAKE_SETTINGS)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Validate body ─────────────────────────────────────────────────
    const { name, description, imageUrl, pointCost, rewardType, rewardValue, applicableTo, maxRedemptionsPerCustomer, totalAvailable, startsAt, expiresAt, isActive, sortOrder } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    if (!pointCost || typeof pointCost !== 'number' || pointCost <= 0) {
      return NextResponse.json({ error: 'pointCost must be greater than 0' }, { status: 400 })
    }

    const resolvedRewardType = rewardType || 'custom'
    if (!VALID_REWARD_TYPES.includes(resolvedRewardType)) {
      return NextResponse.json(
        { error: `rewardType must be one of: ${VALID_REWARD_TYPES.join(', ')}` },
        { status: 400 },
      )
    }

    // ── Insert ──────────────────────────────────────────────────────
    const id = crypto.randomUUID()

    await db.$executeRawUnsafe(
      `INSERT INTO "LoyaltyReward" (
        "id", "locationId", "name", "description", "imageUrl",
        "pointCost", "rewardType", "rewardValue", "applicableTo",
        "maxRedemptionsPerCustomer", "totalAvailable", "totalRedeemed",
        "startsAt", "expiresAt", "isActive", "sortOrder",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8::jsonb, $9::jsonb,
        $10, $11, 0,
        $12, $13, $14, $15,
        NOW(), NOW()
      )`,
      id,
      locationId,
      name.trim(),
      description || null,
      imageUrl || null,
      pointCost,
      resolvedRewardType,
      JSON.stringify(rewardValue || {}),
      JSON.stringify(applicableTo || ['pos', 'cake']),
      maxRedemptionsPerCustomer ?? 0,
      totalAvailable ?? 0,
      startsAt ? new Date(startsAt) : null,
      expiresAt ? new Date(expiresAt) : null,
      isActive !== false,
      sortOrder ?? 0,
    )

    // ── Fetch created reward ──────────────────────────────────────────
    const created = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyReward" WHERE "id" = $1`,
      id,
    )

    return NextResponse.json({ data: created[0] })
  } catch (error) {
    console.error('Failed to create loyalty reward:', error)
    return NextResponse.json({ error: 'Failed to create loyalty reward' }, { status: 500 })
  }
})
