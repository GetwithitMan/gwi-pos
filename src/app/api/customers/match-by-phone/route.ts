import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { normalizePhone } from '@/lib/utils'

// GET - Match a customer by phone number (exact match, with normalization fallback)
// Used by Android terminals during order flow to auto-associate customers
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const phone = searchParams.get('phone')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    if (!phone || phone.trim().length === 0) {
      return NextResponse.json({ error: 'phone is required' }, { status: 400 })
    }

    // Try exact match first, then normalized match
    const normalized = normalizePhone(phone)
    const rows = await db.$queryRawUnsafe<Array<{
      customerId: string
      firstName: string
      lastName: string
      loyaltyPoints: number
      totalSpent: unknown
      totalOrders: number
      tags: unknown
    }>>(
      `SELECT id AS "customerId", "firstName", "lastName",
              "loyaltyPoints", "totalSpent", "totalOrders", tags
       FROM "Customer"
       WHERE (phone = $1 OR ($3::text IS NOT NULL AND phone = $3))
         AND "locationId" = $2
         AND "deletedAt" IS NULL
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      phone.trim(),
      locationId,
      normalized
    )

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
    console.error('Failed to match customer by phone:', error)
    return NextResponse.json({ error: 'Failed to match customer by phone' }, { status: 500 })
  }
})
