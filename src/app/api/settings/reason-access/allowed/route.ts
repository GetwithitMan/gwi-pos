import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'
import { resolveAllowedReasonIds } from '@/lib/settings/reason-access'

// GET ?employeeId=X&reasonType=void_reason|comp_reason|discount
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const reasonType = searchParams.get('reasonType') as 'void_reason' | 'comp_reason' | 'discount' | null

    if (!locationId || !employeeId || !reasonType) {
      return err('locationId, employeeId, and reasonType are required')
    }

    if (!['void_reason', 'comp_reason', 'discount'].includes(reasonType)) {
      return err('reasonType must be "void_reason", "comp_reason", or "discount"')
    }

    const { ids, hasRules } = await resolveAllowedReasonIds(locationId, employeeId, reasonType)

    // If no rules configured, return ALL active reasons (backward compat)
    if (!hasRules) {
      if (reasonType === 'void_reason') {
        const all = await db.voidReason.findMany({
          where: { locationId, isActive: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        })
        return ok({ reasons: all, filtered: false })
      } else if (reasonType === 'comp_reason') {
        const all = await db.compReason.findMany({
          where: { locationId, isActive: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        })
        return ok({ reasons: all, filtered: false })
      } else {
        const all = await db.discountRule.findMany({
          where: { locationId, isActive: true },
          orderBy: [{ priority: 'desc' }, { name: 'asc' }],
        })
        return ok({ reasons: all, filtered: false })
      }
    }

    // Return the actual reason objects for the allowed IDs
    if (reasonType === 'void_reason') {
      const reasons = await db.voidReason.findMany({
        where: { id: { in: ids }, isActive: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      })
      return ok({ reasons, filtered: true })
    } else if (reasonType === 'comp_reason') {
      const reasons = await db.compReason.findMany({
        where: { id: { in: ids }, isActive: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      })
      return ok({ reasons, filtered: true })
    } else {
      const reasons = await db.discountRule.findMany({
        where: { id: { in: ids }, isActive: true },
        orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      })
      return ok({ reasons, filtered: true })
    }
  } catch (error) {
    console.error('Allowed reasons error:', error)
    return err('Failed to fetch allowed reasons', 500)
  }
})
