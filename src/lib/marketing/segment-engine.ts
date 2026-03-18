/**
 * Marketing Segment Engine
 *
 * Resolves audience segments to lists of eligible customers.
 * CRITICAL: Only includes customers with marketingOptIn = true.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('marketing')

export interface SegmentCustomer {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

/**
 * Resolve a named segment to a list of eligible customers.
 * All segments enforce marketingOptIn = true and isActive = true.
 */
export async function resolveSegment(
  db: PrismaClient,
  locationId: string,
  segment: string,
  campaignType: 'email' | 'sms'
): Promise<SegmentCustomer[]> {
  const baseWhere = {
    locationId,
    marketingOptIn: true,
    isActive: true,
    deletedAt: null,
    // Filter by reachable channel
    ...(campaignType === 'email'
      ? { email: { not: null } }
      : { phone: { not: null } }),
  }

  const selectFields = {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
  } as const

  switch (segment) {
    case 'all':
      return db.customer.findMany({
        where: baseWhere,
        select: selectFields,
        orderBy: { lastName: 'asc' },
      })

    case 'vip': {
      // Customers with 'VIP' tag OR in top 20% by totalSpent
      const allCustomers = await db.customer.findMany({
        where: baseWhere,
        select: { ...selectFields, tags: true, totalSpent: true },
        orderBy: { totalSpent: 'desc' },
      })

      if (allCustomers.length === 0) return []

      // Top 20% threshold
      const top20Index = Math.max(1, Math.ceil(allCustomers.length * 0.2))
      const spendThreshold = Number(allCustomers[top20Index - 1]?.totalSpent ?? 0)

      return allCustomers
        .filter((c) => {
          const tags = Array.isArray(c.tags) ? c.tags : []
          const isTagged = tags.some(
            (t: unknown) => typeof t === 'string' && t.toUpperCase() === 'VIP'
          )
          const isHighSpend = Number(c.totalSpent) >= spendThreshold && spendThreshold > 0
          return isTagged || isHighSpend
        })
        .map(({ tags: _tags, totalSpent: _ts, ...rest }) => rest)
    }

    case 'new': {
      // Created in last 30 days
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      return db.customer.findMany({
        where: {
          ...baseWhere,
          createdAt: { gte: thirtyDaysAgo },
        },
        select: selectFields,
        orderBy: { createdAt: 'desc' },
      })
    }

    case 'inactive': {
      // No orders (lastVisit) in last 90 days
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

      return db.customer.findMany({
        where: {
          ...baseWhere,
          OR: [
            { lastVisit: null },
            { lastVisit: { lt: ninetyDaysAgo } },
          ],
        },
        select: selectFields,
        orderBy: { lastName: 'asc' },
      })
    }

    case 'birthday': {
      // Birthday this month
      const now = new Date()
      const currentMonth = now.getMonth() + 1 // 1-indexed

      const customers = await db.customer.findMany({
        where: {
          ...baseWhere,
          birthday: { not: null },
        },
        select: { ...selectFields, birthday: true },
      })

      return customers
        .filter((c) => c.birthday && (c.birthday.getMonth() + 1) === currentMonth)
        .map(({ birthday: _b, ...rest }) => rest)
    }

    case 'high_value': {
      // Top 20% by totalSpent
      const all = await db.customer.findMany({
        where: baseWhere,
        select: { ...selectFields, totalSpent: true },
        orderBy: { totalSpent: 'desc' },
      })

      if (all.length === 0) return []
      const cutoff = Math.max(1, Math.ceil(all.length * 0.2))
      return all
        .slice(0, cutoff)
        .map(({ totalSpent: _ts, ...rest }) => rest)
    }

    default:
      // Unknown segment — return empty
      log.warn(`[Marketing] Unknown segment: ${segment}`)
      return []
  }
}
