import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { generateRedemptionCode } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

/**
 * Verify the portal_session cookie and return session data.
 * Returns null if invalid/expired.
 */
async function verifyPortalSession(locationId: string): Promise<{
  customerId: string
  sessionId: string
} | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('portal_session')?.value
  if (!token) return null

  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT "id", "customerId" FROM "CustomerPortalSession"
     WHERE "sessionToken" = $1
       AND "locationId" = $2
       AND "sessionExpiresAt" > NOW()`,
    token,
    locationId,
  )

  if (rows.length === 0) return null
  return { customerId: rows[0].customerId as string, sessionId: rows[0].id as string }
}

// POST /api/public/portal/[slug]/rewards/redeem — redeem a reward
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params
    const body = await request.json()

    // ── Resolve slug → locationId ───────────────────────────────────
    const locations = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id" FROM "Location" WHERE "slug" = $1 LIMIT 1`,
      slug,
    )

    if (locations.length === 0) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const locationId = locations[0].id as string

    // ── Session auth ──────────────────────────────────────────────────
    const session = await verifyPortalSession(locationId)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized — please log in' }, { status: 401 })
    }

    const customerId = session.customerId

    // ── Validate body ─────────────────────────────────────────────────
    const { rewardId } = body
    if (!rewardId || typeof rewardId !== 'string') {
      return NextResponse.json({ error: 'rewardId is required' }, { status: 400 })
    }

    // ── Fetch reward ──────────────────────────────────────────────────
    const rewardRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyReward"
       WHERE "id" = $1
         AND "locationId" = $2
         AND "isActive" = true
         AND "deletedAt" IS NULL
         AND ("startsAt" IS NULL OR "startsAt" <= NOW())
         AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`,
      rewardId,
      locationId,
    )

    if (rewardRows.length === 0) {
      return NextResponse.json({ error: 'Reward not found or not available' }, { status: 404 })
    }

    const reward = rewardRows[0]
    const pointCost = Number(reward.pointCost)

    // ── Check sold out ────────────────────────────────────────────────
    const totalAvailable = Number(reward.totalAvailable ?? 0)
    const totalRedeemed = Number(reward.totalRedeemed ?? 0)
    if (totalAvailable > 0 && totalRedeemed >= totalAvailable) {
      return NextResponse.json({ error: 'Reward is sold out' }, { status: 409 })
    }

    // ── Check per-customer limit ──────────────────────────────────────
    const maxPerCustomer = Number(reward.maxRedemptionsPerCustomer ?? 0)
    if (maxPerCustomer > 0) {
      const countRows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS "count" FROM "LoyaltyRedemption"
         WHERE "customerId" = $1 AND "rewardId" = $2 AND "status" != 'cancelled'`,
        customerId,
        rewardId,
      )
      const customerRedemptions = Number(countRows[0]?.count ?? 0)
      if (customerRedemptions >= maxPerCustomer) {
        return NextResponse.json({ error: 'Maximum redemptions reached for this reward' }, { status: 409 })
      }
    }

    // ── Fetch customer points ─────────────────────────────────────────
    const customerRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "loyaltyPoints" FROM "Customer" WHERE "id" = $1`,
      customerId,
    )

    const currentPoints = Number(customerRows[0]?.loyaltyPoints ?? 0)
    if (currentPoints < pointCost) {
      return NextResponse.json(
        { error: 'Not enough loyalty points', required: pointCost, available: currentPoints },
        { status: 400 },
      )
    }

    // ── Deduct points ─────────────────────────────────────────────────
    await db.$executeRawUnsafe(
      `UPDATE "Customer"
       SET "loyaltyPoints" = "loyaltyPoints" - $2, "updatedAt" = NOW()
       WHERE "id" = $1`,
      customerId,
      pointCost,
    )

    // ── Generate redemption code (retry on collision) ─────────────────
    let redemptionCode: string
    let attempts = 0
    while (true) {
      redemptionCode = generateRedemptionCode()
      const existing = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT 1 FROM "LoyaltyRedemption" WHERE "redemptionCode" = $1`,
        redemptionCode,
      )
      if (existing.length === 0) break
      attempts++
      if (attempts > 5) {
        // Extremely unlikely — restore points and bail
        await db.$executeRawUnsafe(
          `UPDATE "Customer" SET "loyaltyPoints" = "loyaltyPoints" + $2, "updatedAt" = NOW() WHERE "id" = $1`,
          customerId,
          pointCost,
        )
        return NextResponse.json({ error: 'Failed to generate unique code' }, { status: 500 })
      }
    }

    // ── Insert redemption ─────────────────────────────────────────────
    const redemptionId = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    await db.$executeRawUnsafe(
      `INSERT INTO "LoyaltyRedemption" (
        "id", "locationId", "customerId", "rewardId", "pointsSpent",
        "status", "redemptionCode", "redeemedAt", "expiresAt",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        'pending', $6, NOW(), $7,
        NOW(), NOW()
      )`,
      redemptionId,
      locationId,
      customerId,
      rewardId,
      pointCost,
      redemptionCode,
      expiresAt,
    )

    // ── Return ────────────────────────────────────────────────────────
    const pointsRemaining = currentPoints - pointCost

    return NextResponse.json({
      redemptionCode,
      expiresAt: expiresAt.toISOString(),
      pointsRemaining,
    })
  } catch (error) {
    console.error('Failed to redeem loyalty reward:', error)
    return NextResponse.json({ error: 'Failed to redeem reward' }, { status: 500 })
  }
})
