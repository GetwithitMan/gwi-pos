import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { err, ok } from '@/lib/api-response'

// POST /api/loyalty/earn — earn points from an order
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const locationId = actor.locationId || body.locationId

    if (!locationId) {
      return err('locationId is required')
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
      return err('customerId is required')
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return err('amount must be a positive number (in dollars)')
    }

    // Idempotency: reject duplicate earn for the same orderId (prevents point farming)
    if (orderId) {
      try {
        const existing = await db.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "LoyaltyTransaction" WHERE "orderId" = $1 AND "type" = 'earn' AND "locationId" = $2 LIMIT 1`,
          orderId,
          locationId,
        )
        if (existing.length > 0) {
          return NextResponse.json(
            { error: 'Points already earned for this order', alreadyEarned: true },
            { status: 409 },
          )
        }
      } catch (e: any) {
        // Graceful degradation if LoyaltyTransaction table doesn't exist yet
        if (!e?.message?.includes('does not exist') && e?.code !== '42P01') {
          throw e
        }
      }
    }

    // Wrap entire earn operation in a transaction with FOR UPDATE to prevent
    // concurrent earn+redeem from corrupting the balance via read-then-write race.
    const result = await db.$transaction(async (tx) => {
      // Lock the Customer row to serialize concurrent loyalty operations
      const customers = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT c."id", c."loyaltyPoints", c."lifetimePoints", c."loyaltyProgramId", c."loyaltyTierId"
         FROM "Customer" c
         WHERE c."id" = $1 AND c."locationId" = $2 AND c."deletedAt" IS NULL
         FOR UPDATE`,
        customerId,
        locationId,
      )

      if (customers.length === 0) {
        return { error: 'Customer not found', status: 404 } as const
      }

      const customer = customers[0]

      if (!customer.loyaltyProgramId) {
        return { error: 'Customer is not enrolled in a loyalty program', status: 400 } as const
      }

      // Fetch program (scoped to location)
      const programs = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "LoyaltyProgram"
         WHERE "id" = $1 AND "locationId" = $2 AND "isActive" = true AND "deletedAt" IS NULL`,
        customer.loyaltyProgramId,
        locationId,
      )

      if (programs.length === 0) {
        return { error: 'Loyalty program is not active', status: 400 } as const
      }

      const program = programs[0]

      // Get tier multiplier
      let tierMultiplier = 1.0
      let tierName: string | null = null
      if (customer.loyaltyTierId) {
        const tiers = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
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
        return { data: { pointsEarned: 0, newBalance: Number(customer.loyaltyPoints) } } as const
      }

      const currentPoints = Number(customer.loyaltyPoints)
      const currentLifetime = Number(customer.lifetimePoints)

      // Create transaction record
      const txnId = crypto.randomUUID()

      const description = tierName
        ? `Earned ${pointsEarned} points on $${amount.toFixed(2)} order (${tierMultiplier}x ${tierName} multiplier)`
        : `Earned ${pointsEarned} points on $${amount.toFixed(2)} order`

      await tx.$executeRawUnsafe(
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
        currentPoints + pointsEarned,
        description,
        employeeId || null,
        JSON.stringify({
          orderAmount: amount,
          pointsPerDollar,
          tierMultiplier,
          tierName,
        }),
      )

      // Atomically INCREMENT customer points (not absolute SET) to prevent race conditions
      await tx.$executeRawUnsafe(
        `UPDATE "Customer"
         SET "loyaltyPoints" = "loyaltyPoints" + $2,
             "lifetimePoints" = "lifetimePoints" + $2,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        customerId,
        pointsEarned,
      )

      // Read back the new balances after atomic increment
      const updatedCustomer = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "loyaltyPoints", "lifetimePoints" FROM "Customer" WHERE "id" = $1`,
        customerId,
      )
      const newBalance = Number(updatedCustomer[0].loyaltyPoints)
      const newLifetime = Number(updatedCustomer[0].lifetimePoints)

      // Check tier promotion
      let promoted = false
      let newTierName: string | null = null

      const allTiers = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "id", "name", "minimumPoints" FROM "LoyaltyTier"
         WHERE "programId" = $1 AND "deletedAt" IS NULL
         ORDER BY "minimumPoints" DESC`,
        customer.loyaltyProgramId,
      )

      for (const tier of allTiers) {
        if (newLifetime >= Number(tier.minimumPoints)) {
          if (tier.id !== customer.loyaltyTierId) {
            await tx.$executeRawUnsafe(
              `UPDATE "Customer" SET "loyaltyTierId" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
              customerId,
              tier.id,
            )
            promoted = true
            newTierName = tier.name as string

            // Record tier bonus transaction
            const bonusTxnId = crypto.randomUUID()
            await tx.$executeRawUnsafe(
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

      return {
        data: {
          pointsEarned,
          newBalance,
          lifetimePoints: newLifetime,
          promoted,
          newTierName,
          transactionId: txnId,
        },
      }
    }, { timeout: 15000 })

    if ('error' in result) {
      return err(result.error, result.status)
    }

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'updated' })

    return ok(result)
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to earn loyalty points:', error)
    return err('Failed to earn loyalty points', 500)
  }
})
