import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { err, ok } from '@/lib/api-response'

// POST /api/loyalty/redeem — redeem points for a dollar discount
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

    const { customerId, points, orderId } = body

    if (!customerId) {
      return err('customerId is required')
    }
    if (!points || typeof points !== 'number' || points <= 0) {
      return err('points must be a positive number')
    }

    // Wrap entire redeem operation in a transaction with FOR UPDATE to prevent
    // concurrent earn+redeem from corrupting the balance via read-then-write race.
    const result = await db.$transaction(async (tx) => {
      // Lock the Customer row to serialize concurrent loyalty operations
      const customers = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "id", "loyaltyPoints", "loyaltyProgramId"
         FROM "Customer"
         WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
         FOR UPDATE`,
        customerId,
        locationId,
      )

      if (customers.length === 0) {
        return { error: 'Customer not found', status: 404 } as const
      }

      const customer = customers[0]
      const currentPoints = Number(customer.loyaltyPoints)

      if (!customer.loyaltyProgramId) {
        return { error: 'Customer is not enrolled in a loyalty program', status: 400 } as const
      }

      // Fetch program for minimum redeem check and point value (scoped to location)
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
      const minimumRedeemPoints = Number(program.minimumRedeemPoints) || 0
      const pointValueCents = Number(program.pointValueCents) || 1

      if (points < minimumRedeemPoints) {
        return {
          error: `Minimum ${minimumRedeemPoints} points required for redemption`,
          status: 400,
        } as const
      }

      if (currentPoints < points) {
        return {
          error: `Insufficient points. Customer has ${currentPoints} points.`,
          status: 400,
        } as const
      }

      // Calculate dollar value: points * (pointValueCents / 100)
      const dollarValue = Math.round(points * pointValueCents) / 100

      // Create transaction record
      const txnId = crypto.randomUUID()

      await tx.$executeRawUnsafe(
        `INSERT INTO "LoyaltyTransaction" (
          "id", "customerId", "locationId", "orderId", "type", "points",
          "balanceBefore", "balanceAfter", "description", "employeeId",
          "metadata", "createdAt"
        ) VALUES ($1, $2, $3, $4, 'redeem', $5, $6, $7, $8, $9, $10::jsonb, NOW())`,
        txnId,
        customerId,
        locationId,
        orderId || null,
        -points, // Negative for redemptions
        currentPoints,
        currentPoints - points,
        `Redeemed ${points} points for $${dollarValue.toFixed(2)} discount`,
        employeeId || null,
        JSON.stringify({ dollarValue, pointValueCents }),
      )

      // Atomically DECREMENT customer points (not absolute SET) to prevent race conditions.
      // GREATEST(0, ...) prevents negative balance from concurrent operations.
      await tx.$executeRawUnsafe(
        `UPDATE "Customer"
         SET "loyaltyPoints" = GREATEST(0, "loyaltyPoints" - $2), "updatedAt" = NOW()
         WHERE "id" = $1`,
        customerId,
        points,
      )

      // Read back the new balance after atomic decrement
      const updatedCustomer = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "loyaltyPoints" FROM "Customer" WHERE "id" = $1`,
        customerId,
      )
      const newBalance = Number(updatedCustomer[0].loyaltyPoints)

      return {
        data: {
          pointsRedeemed: points,
          dollarValue,
          newBalance,
          transactionId: txnId,
        },
      }
    }, { timeout: 15000 })

    if ('error' in result) {
      return err(result.error!, result.status)
    }

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'updated' })

    return ok(result)
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to redeem loyalty points:', error)
    return err('Failed to redeem loyalty points', 500)
  }
})
