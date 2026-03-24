import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// POST /api/loyalty/earn — earn points from an order
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const locationId = actor.locationId || body.locationId

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    const { customerId, orderId, amount } = body

    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number (in dollars)' }, { status: 400 })
    }

    // Fetch customer with program and tier info
    const customers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT c."id", c."loyaltyPoints", c."lifetimePoints", c."loyaltyProgramId", c."loyaltyTierId"
       FROM "Customer" c
       WHERE c."id" = $1 AND c."deletedAt" IS NULL`,
      customerId,
    )

    if (customers.length === 0) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const customer = customers[0]

    if (!customer.loyaltyProgramId) {
      return NextResponse.json({ error: 'Customer is not enrolled in a loyalty program' }, { status: 400 })
    }

    // Fetch program
    const programs = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyProgram"
       WHERE "id" = $1 AND "isActive" = true AND "deletedAt" IS NULL`,
      customer.loyaltyProgramId,
    )

    if (programs.length === 0) {
      return NextResponse.json({ error: 'Loyalty program is not active' }, { status: 400 })
    }

    const program = programs[0]

    // Get tier multiplier
    let tierMultiplier = 1.0
    let tierName: string | null = null
    if (customer.loyaltyTierId) {
      const tiers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "pointsMultiplier", "name" FROM "LoyaltyTier"
         WHERE "id" = $1 AND "deletedAt" IS NULL`,
        customer.loyaltyTierId,
      )
      if (tiers.length > 0) {
        tierMultiplier = Number(tiers[0].pointsMultiplier) || 1.0
        tierName = tiers[0].name as string
      }
    }

    // Calculate points: floor(amount * pointsPerDollar * tierMultiplier)
    const pointsPerDollar = Number(program.pointsPerDollar) || 1
    const roundingMode = (program.roundingMode as string) || 'floor'
    const rawPoints = amount * pointsPerDollar * tierMultiplier

    let pointsEarned: number
    switch (roundingMode) {
      case 'ceil':
        pointsEarned = Math.ceil(rawPoints)
        break
      case 'round':
        pointsEarned = Math.round(rawPoints)
        break
      default: // floor
        pointsEarned = Math.floor(rawPoints)
    }

    if (pointsEarned <= 0) {
      return NextResponse.json({ data: { pointsEarned: 0, newBalance: Number(customer.loyaltyPoints) } })
    }

    const currentPoints = Number(customer.loyaltyPoints)
    const newBalance = currentPoints + pointsEarned
    const currentLifetime = Number(customer.lifetimePoints)
    const newLifetime = currentLifetime + pointsEarned

    // Create transaction
    const txnId = crypto.randomUUID()

    const description = tierName
      ? `Earned ${pointsEarned} points on $${amount.toFixed(2)} order (${tierMultiplier}x ${tierName} multiplier)`
      : `Earned ${pointsEarned} points on $${amount.toFixed(2)} order`

    await db.$executeRawUnsafe(
      `INSERT INTO "LoyaltyTransaction" (
        "id", "customerId", "locationId", "orderId", "type", "points",
        "balanceBefore", "balanceAfter", "description", "employeeId",
        "metadata", "createdAt"
      ) VALUES ($1, $2, $3, $4, 'earn', $5, $6, $7, $8, $9, $10::jsonb, NOW())`,
      txnId,
      customerId,
      locationId,
      orderId || null,
      pointsEarned,
      currentPoints,
      newBalance,
      description,
      employeeId || null,
      JSON.stringify({
        orderAmount: amount,
        pointsPerDollar,
        tierMultiplier,
        tierName,
      }),
    )

    // Update customer points
    await db.$executeRawUnsafe(
      `UPDATE "Customer"
       SET "loyaltyPoints" = $2,
           "lifetimePoints" = $3,
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      customerId,
      newBalance,
      newLifetime,
    )

    // Check tier promotion
    let promoted = false
    let newTierName: string | null = null

    const allTiers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id", "name", "minimumPoints" FROM "LoyaltyTier"
       WHERE "programId" = $1 AND "deletedAt" IS NULL
       ORDER BY "minimumPoints" DESC`,
      customer.loyaltyProgramId,
    )

    for (const tier of allTiers) {
      if (newLifetime >= Number(tier.minimumPoints)) {
        if (tier.id !== customer.loyaltyTierId) {
          await db.$executeRawUnsafe(
            `UPDATE "Customer" SET "loyaltyTierId" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
            customerId,
            tier.id,
          )
          promoted = true
          newTierName = tier.name as string

          // Record tier bonus transaction
          const bonusTxnId = crypto.randomUUID()
          await db.$executeRawUnsafe(
            `INSERT INTO "LoyaltyTransaction" (
              "id", "customerId", "locationId", "type", "points",
              "balanceBefore", "balanceAfter", "description", "createdAt"
            ) VALUES ($1, $2, $3, 'tier_bonus', 0, $4, $4, $5, NOW())`,
            bonusTxnId,
            customerId,
            locationId,
            newBalance,
            `Promoted to ${tier.name} tier`,
          )
        }
        break // Only match the highest tier
      }
    }

    return NextResponse.json({
      data: {
        pointsEarned,
        newBalance,
        lifetimePoints: newLifetime,
        promoted,
        newTierName,
        transactionId: txnId,
      },
    })
  } catch (error) {
    console.error('Failed to earn loyalty points:', error)
    return NextResponse.json({ error: 'Failed to earn loyalty points' }, { status: 500 })
  }
})
