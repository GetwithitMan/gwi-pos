import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

const VALID_REWARD_TYPES = ['free_item', 'discount_percent', 'discount_fixed', 'free_delivery', 'custom']

// GET /api/loyalty/rewards — list rewards for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
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

    const rewards = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "LoyaltyReward"
       WHERE ${whereClause}
       ORDER BY "sortOrder" ASC, "createdAt" ASC`

    return ok(rewards)
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to list loyalty rewards:', error)
    return err('Failed to list loyalty rewards', 500)
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
      return err('locationId is required')
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
      return err('name is required')
    }

    if (!pointCost || typeof pointCost !== 'number' || pointCost <= 0) {
      return err('pointCost must be greater than 0')
    }

    const resolvedRewardType = rewardType || 'custom'
    if (!VALID_REWARD_TYPES.includes(resolvedRewardType)) {
      return err(`rewardType must be one of: ${VALID_REWARD_TYPES.join(', ')}`)
    }

    // ── Insert ──────────────────────────────────────────────────────
    const id = crypto.randomUUID()

    await db.$executeRaw`INSERT INTO "LoyaltyReward" (
        "id", "locationId", "name", "description", "imageUrl",
        "pointCost", "rewardType", "rewardValue", "applicableTo",
        "maxRedemptionsPerCustomer", "totalAvailable", "totalRedeemed",
        "startsAt", "expiresAt", "isActive", "sortOrder",
        "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${locationId}, ${name.trim()}, ${description || null}, ${imageUrl || null},
        ${pointCost}, ${resolvedRewardType}, ${JSON.stringify(rewardValue || {})}::jsonb, ${JSON.stringify(applicableTo || ['pos', 'cake'])}::jsonb,
        ${maxRedemptionsPerCustomer ?? 0}, ${totalAvailable ?? 0}, 0,
        ${startsAt ? new Date(startsAt) : null}, ${expiresAt ? new Date(expiresAt) : null}, ${isActive !== false}, ${sortOrder ?? 0},
        NOW(), NOW()
      )`

    // ── Fetch created reward ──────────────────────────────────────────
    const created = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "LoyaltyReward" WHERE "id" = ${id}`

    return ok(created[0])
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to create loyalty reward:', error)
    return err('Failed to create loyalty reward', 500)
  }
})
