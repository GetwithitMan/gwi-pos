import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Match a customer by saved card last4 (+ optional cardBrand)
// Used by Android terminals during payment flow to auto-associate customers
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const last4 = searchParams.get('last4')
    const cardBrand = searchParams.get('cardBrand')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    if (!last4 || !/^\d{4}$/.test(last4)) {
      return NextResponse.json({ error: 'last4 must be exactly 4 digits' }, { status: 400 })
    }

    // Build query — join SavedCard → Customer
    // Return the most recently created card match
    let query: string
    let params: unknown[]

    if (cardBrand) {
      query = `
        SELECT c.id AS "customerId", c."firstName", c."lastName",
               c."loyaltyPoints", c."totalSpent", c."totalOrders", c.tags
        FROM "SavedCard" sc
        JOIN "Customer" c ON c.id = sc."customerId"
        WHERE sc.last4 = $1
          AND sc."locationId" = $2
          AND sc."cardBrand" = $3
          AND sc."deletedAt" IS NULL
          AND c."deletedAt" IS NULL
        ORDER BY sc."createdAt" DESC
        LIMIT 1
      `
      params = [last4, locationId, cardBrand]
    } else {
      query = `
        SELECT c.id AS "customerId", c."firstName", c."lastName",
               c."loyaltyPoints", c."totalSpent", c."totalOrders", c.tags
        FROM "SavedCard" sc
        JOIN "Customer" c ON c.id = sc."customerId"
        WHERE sc.last4 = $1
          AND sc."locationId" = $2
          AND sc."deletedAt" IS NULL
          AND c."deletedAt" IS NULL
        ORDER BY sc."createdAt" DESC
        LIMIT 1
      `
      params = [last4, locationId]
    }

    const rows = await db.$queryRawUnsafe<Array<{
      customerId: string
      firstName: string
      lastName: string
      loyaltyPoints: number
      totalSpent: unknown
      totalOrders: number
      tags: unknown
    }>>(query, ...params)

    if (!rows.length) {
      return NextResponse.json({ error: 'No matching customer found' }, { status: 404 })
    }

    const row = rows[0]
    const tags = (row.tags ?? []) as string[]

    return NextResponse.json({
      data: {
        customerId: row.customerId,
        firstName: row.firstName,
        lastName: row.lastName,
        loyaltyPoints: row.loyaltyPoints,
        totalSpent: Number(row.totalSpent),
        totalOrders: row.totalOrders,
        tags,
      },
    })
  } catch (error) {
    console.error('Failed to match customer by card:', error)
    return NextResponse.json({ error: 'Failed to match customer by card' }, { status: 500 })
  }
})
