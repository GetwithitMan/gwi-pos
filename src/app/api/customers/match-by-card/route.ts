import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Match a customer by saved card last4 (+ optional cardBrand)
// Checks both SavedCard and CardProfile tables for maximum recognition coverage.
// Used by Android terminals during payment flow to auto-associate customers
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const last4 = searchParams.get('last4')
    const cardBrand = searchParams.get('cardBrand')

    if (!locationId) {
      return err('locationId is required')
    }
    if (!last4 || !/^\d{4}$/.test(last4)) {
      return err('last4 must be exactly 4 digits')
    }

    // Auth check — require customers.view permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? searchParams.get('employeeId')
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.CUSTOMERS_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Strategy 1: Check SavedCard table (explicit card-on-file)
    let query: string
    let params: unknown[]

    if (cardBrand) {
      query = `
        SELECT c.id AS "customerId", c."firstName", c."lastName",
               c."loyaltyPoints", c."totalSpent", c."totalOrders", c.tags,
               'saved_card' AS "matchSource"
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
               c."loyaltyPoints", c."totalSpent", c."totalOrders", c.tags,
               'saved_card' AS "matchSource"
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

    const savedCardRows = await db.$queryRawUnsafe<Array<{
      customerId: string
      firstName: string
      lastName: string
      loyaltyPoints: number
      totalSpent: unknown
      totalOrders: number
      tags: unknown
      matchSource: string
    }>>(query, ...params)

    if (savedCardRows.length) {
      const row = savedCardRows[0]
      const tags = (row.tags ?? []) as string[]
      return ok({
          customerId: row.customerId,
          firstName: row.firstName,
          lastName: row.lastName,
          loyaltyPoints: row.loyaltyPoints,
          totalSpent: Number(row.totalSpent),
          totalOrders: row.totalOrders,
          tags,
          matchSource: 'saved_card',
        })
    }

    // Strategy 2: Check CardProfile table (auto-recognized from previous payments)
    const cardProfile = await db.cardProfile.findFirst({
      where: {
        locationId,
        cardLast4: last4,
        customerId: { not: null },
        deletedAt: null,
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            loyaltyPoints: true,
            totalSpent: true,
            totalOrders: true,
            tags: true,
            deletedAt: true,
          },
        },
      },
      orderBy: { lastSeenAt: 'desc' },
    })

    if (cardProfile?.customer && !cardProfile.customer.deletedAt) {
      const c = cardProfile.customer
      const tags = (c.tags ?? []) as string[]
      return ok({
          customerId: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          loyaltyPoints: c.loyaltyPoints,
          totalSpent: Number(c.totalSpent),
          totalOrders: c.totalOrders,
          tags,
          matchSource: 'card_profile',
        })
    }

    return notFound('No matching customer found')
  } catch (error) {
    console.error('Failed to match customer by card:', error)
    return err('Failed to match customer by card', 500)
  }
})
