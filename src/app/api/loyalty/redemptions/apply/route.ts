import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok } from '@/lib/api-response'

// POST /api/loyalty/redemptions/apply — apply a pending redemption to an order
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
      return err('redemptionCode is required')
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
      return notFound('Redemption code not found or already used')
    }

    const redemption = rows[0]

    // ── Check expiry ──────────────────────────────────────────────────
    if (redemption.expiresAt && new Date(redemption.expiresAt as string) < new Date()) {
      // Mark as expired
      await db.$executeRawUnsafe(
        `UPDATE "LoyaltyRedemption" SET "status" = 'expired', "updatedAt" = NOW() WHERE "id" = $1`,
        redemption.id,
      )
      return err('Redemption code has expired', 410)
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

    return ok({
      success: true,
      reward: {
        name: redemption.rewardName,
        rewardType: redemption.rewardType,
        rewardValue: redemption.rewardValue,
        pointCost: redemption.pointCost,
      },
    })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to apply loyalty redemption:', error)
    return err('Failed to apply loyalty redemption', 500)
  }
})
