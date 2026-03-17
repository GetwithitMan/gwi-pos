import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// POST /api/loyalty/redemptions/apply — apply a pending redemption to an order
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

    // ── Permission check (pos.access OR cake.payment) ─────────────────
    const auth = await requireAnyPermission(employeeId, locationId, [
      PERMISSIONS.POS_ACCESS,
      PERMISSIONS.CAKE_PAYMENT,
    ])
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Validate body ─────────────────────────────────────────────────
    const { redemptionCode, orderId, cakeOrderId } = body

    if (!redemptionCode || typeof redemptionCode !== 'string') {
      return NextResponse.json({ error: 'redemptionCode is required' }, { status: 400 })
    }

    // ── Find pending redemption ───────────────────────────────────────
    const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT lr.*, rw."name" AS "rewardName", rw."rewardType", rw."rewardValue", rw."pointCost"
       FROM "LoyaltyRedemption" lr
       JOIN "LoyaltyReward" rw ON rw."id" = lr."rewardId"
       WHERE lr."redemptionCode" = $1 AND lr."status" = 'pending' AND lr."locationId" = $2`,
      redemptionCode.trim().toUpperCase(),
      locationId,
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Redemption code not found or already used' }, { status: 404 })
    }

    const redemption = rows[0]

    // ── Check expiry ──────────────────────────────────────────────────
    if (redemption.expiresAt && new Date(redemption.expiresAt as string) < new Date()) {
      // Mark as expired
      await db.$executeRawUnsafe(
        `UPDATE "LoyaltyRedemption" SET "status" = 'expired', "updatedAt" = NOW() WHERE "id" = $1`,
        redemption.id,
      )
      return NextResponse.json({ error: 'Redemption code has expired' }, { status: 410 })
    }

    // ── Apply redemption ──────────────────────────────────────────────
    await db.$executeRawUnsafe(
      `UPDATE "LoyaltyRedemption"
       SET "status" = 'applied',
           "orderId" = $2,
           "cakeOrderId" = $3,
           "appliedAt" = NOW(),
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      redemption.id,
      orderId || null,
      cakeOrderId || null,
    )

    // ── Increment totalRedeemed on reward ─────────────────────────────
    await db.$executeRawUnsafe(
      `UPDATE "LoyaltyReward"
       SET "totalRedeemed" = "totalRedeemed" + 1, "updatedAt" = NOW()
       WHERE "id" = $1`,
      redemption.rewardId,
    )

    return NextResponse.json({
      success: true,
      reward: {
        name: redemption.rewardName,
        rewardType: redemption.rewardType,
        rewardValue: redemption.rewardValue,
        pointCost: redemption.pointCost,
      },
    })
  } catch (error) {
    console.error('Failed to apply loyalty redemption:', error)
    return NextResponse.json({ error: 'Failed to apply loyalty redemption' }, { status: 500 })
  }
})
