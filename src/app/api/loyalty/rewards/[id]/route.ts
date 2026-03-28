import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok } from '@/lib/api-response'

// GET /api/loyalty/rewards/[id] — fetch a single reward
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

    // ── Fetch ─────────────────────────────────────────────────────────
    const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyReward"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId,
    )

    if (rows.length === 0) {
      return notFound('Reward not found')
    }

    return ok(rows[0])
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to fetch loyalty reward:', error)
    return err('Failed to fetch loyalty reward', 500)
  }
})

// PATCH /api/loyalty/rewards/[id] — update a reward
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
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

    // ── Verify exists ─────────────────────────────────────────────────
    const existing = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id" FROM "LoyaltyReward"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId,
    )

    if (existing.length === 0) {
      return notFound('Reward not found')
    }

    // ── Build dynamic SET clause ──────────────────────────────────────
    const VALID_REWARD_TYPES = ['free_item', 'discount_percent', 'discount_fixed', 'free_delivery', 'custom']
    const setClauses: string[] = ['"updatedAt" = NOW()']
    const setParams: unknown[] = []
    let paramIdx = 1

    const fieldMap: Record<string, { column: string; transform?: (v: unknown) => unknown; jsonb?: boolean }> = {
      name: { column: 'name', transform: (v) => typeof v === 'string' ? v.trim() : v },
      description: { column: 'description' },
      imageUrl: { column: 'imageUrl' },
      pointCost: { column: 'pointCost' },
      rewardType: { column: 'rewardType' },
      rewardValue: { column: 'rewardValue', jsonb: true },
      applicableTo: { column: 'applicableTo', jsonb: true },
      maxRedemptionsPerCustomer: { column: 'maxRedemptionsPerCustomer' },
      totalAvailable: { column: 'totalAvailable' },
      startsAt: { column: 'startsAt', transform: (v) => v ? new Date(v as string) : null },
      expiresAt: { column: 'expiresAt', transform: (v) => v ? new Date(v as string) : null },
      isActive: { column: 'isActive' },
      sortOrder: { column: 'sortOrder' },
    }

    for (const [key, { column, transform, jsonb }] of Object.entries(fieldMap)) {
      if (key in body) {
        const value = transform ? transform(body[key]) : body[key]
        if (jsonb) {
          setClauses.push(`"${column}" = $${paramIdx}::jsonb`)
          setParams.push(JSON.stringify(value))
        } else {
          setClauses.push(`"${column}" = $${paramIdx}`)
          setParams.push(value)
        }
        paramIdx++
      }
    }

    // Validate rewardType if being updated
    if ('rewardType' in body && !VALID_REWARD_TYPES.includes(body.rewardType)) {
      return err(`rewardType must be one of: ${VALID_REWARD_TYPES.join(', ')}`)
    }

    // Validate pointCost if being updated
    if ('pointCost' in body && (typeof body.pointCost !== 'number' || body.pointCost <= 0)) {
      return err('pointCost must be greater than 0')
    }

    if (setClauses.length === 1) {
      // Only "updatedAt" — nothing to update
      return err('No fields to update')
    }

    // Add WHERE params
    setParams.push(id, locationId)

    await db.$executeRawUnsafe(
      `UPDATE "LoyaltyReward"
       SET ${setClauses.join(', ')}
       WHERE "id" = $${paramIdx} AND "locationId" = $${paramIdx + 1} AND "deletedAt" IS NULL`,
      ...setParams,
    )

    // ── Fetch updated ─────────────────────────────────────────────────
    const updated = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyReward" WHERE "id" = $1`,
      id,
    )

    return ok(updated[0])
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to update loyalty reward:', error)
    return err('Failed to update loyalty reward', 500)
  }
})

// DELETE /api/loyalty/rewards/[id] — soft delete a reward
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

    // ── Soft delete ───────────────────────────────────────────────────
    const result = await db.$executeRawUnsafe(
      `UPDATE "LoyaltyReward"
       SET "deletedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id,
      locationId,
    )

    if (result === 0) {
      return notFound('Reward not found')
    }

    return ok({ success: true })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to delete loyalty reward:', error)
    return err('Failed to delete loyalty reward', 500)
  }
})
