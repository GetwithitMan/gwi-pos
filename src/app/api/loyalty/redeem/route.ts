import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'

// POST /api/loyalty/redeem — redeem points for a dollar discount
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

    const { customerId, points, orderId } = body

    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
    }
    if (!points || typeof points !== 'number' || points <= 0) {
      return NextResponse.json({ error: 'points must be a positive number' }, { status: 400 })
    }

    // Fetch customer (scoped to location)
    const customers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id", "loyaltyPoints", "loyaltyProgramId"
       FROM "Customer"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      customerId,
      locationId,
    )

    if (customers.length === 0) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const customer = customers[0]
    const currentPoints = Number(customer.loyaltyPoints)

    if (!customer.loyaltyProgramId) {
      return NextResponse.json({ error: 'Customer is not enrolled in a loyalty program' }, { status: 400 })
    }

    // Fetch program for minimum redeem check and point value (scoped to location)
    const programs = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "LoyaltyProgram"
       WHERE "id" = $1 AND "locationId" = $2 AND "isActive" = true AND "deletedAt" IS NULL`,
      customer.loyaltyProgramId,
      locationId,
    )

    if (programs.length === 0) {
      return NextResponse.json({ error: 'Loyalty program is not active' }, { status: 400 })
    }

    const program = programs[0]
    const minimumRedeemPoints = Number(program.minimumRedeemPoints) || 0
    const pointValueCents = Number(program.pointValueCents) || 1

    if (points < minimumRedeemPoints) {
      return NextResponse.json(
        { error: `Minimum ${minimumRedeemPoints} points required for redemption` },
        { status: 400 },
      )
    }

    if (currentPoints < points) {
      return NextResponse.json(
        { error: `Insufficient points. Customer has ${currentPoints} points.` },
        { status: 400 },
      )
    }

    // Calculate dollar value: points * (pointValueCents / 100)
    const dollarValue = Math.round(points * pointValueCents) / 100

    const newBalance = currentPoints - points

    // Create transaction
    const txnId = crypto.randomUUID()

    await db.$executeRawUnsafe(
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
      newBalance,
      `Redeemed ${points} points for $${dollarValue.toFixed(2)} discount`,
      employeeId || null,
      JSON.stringify({ dollarValue, pointValueCents }),
    )

    // Deduct points
    await db.$executeRawUnsafe(
      `UPDATE "Customer"
       SET "loyaltyPoints" = $2, "updatedAt" = NOW()
       WHERE "id" = $1`,
      customerId,
      newBalance,
    )

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'updated' })

    return NextResponse.json({
      data: {
        pointsRedeemed: points,
        dollarValue,
        newBalance,
        transactionId: txnId,
      },
    })
  } catch (error) {
    console.error('Failed to redeem loyalty points:', error)
    return NextResponse.json({ error: 'Failed to redeem loyalty points' }, { status: 500 })
  }
})
