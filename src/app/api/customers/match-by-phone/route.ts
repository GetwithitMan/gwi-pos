import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { normalizePhone } from '@/lib/utils'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Match a customer by phone number (exact match, with normalization fallback)
// Used by Android terminals during order flow to auto-associate customers
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const phone = searchParams.get('phone')

    if (!locationId) {
      return err('locationId is required')
    }
    if (!phone || phone.trim().length === 0) {
      return err('phone is required')
    }

    // Auth check — require customers.view permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? searchParams.get('employeeId')
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.CUSTOMERS_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

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
      return notFound('No matching customer found')
    }

    const row = rows[0]
    const tags = (row.tags ?? []) as string[]

    return ok({
        customerId: row.customerId,
        firstName: row.firstName,
        lastName: row.lastName,
        loyaltyPoints: row.loyaltyPoints,
        totalSpent: Number(row.totalSpent),
        totalOrders: row.totalOrders,
        tags,
      })
  } catch (error) {
    console.error('Failed to match customer by phone:', error)
    return err('Failed to match customer by phone', 500)
  }
})
