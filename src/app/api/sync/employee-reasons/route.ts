import { NextRequest } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { resolveAllowedReasonIds } from '@/lib/settings/reason-access'
import { getRequestLocationId } from '@/lib/request-context'
import { err, notFound, ok } from '@/lib/api-response'

// GET ?employeeId=X → returns allowed voidReasons, compReasons, discountPresets for that employee
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')

    if (!employeeId) {
      return err('employeeId is required')
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      const employee = await adminDb.employee.findUnique({
        where: { id: employeeId },
        select: { locationId: true },
      })
      if (!employee) {
        return notFound('Employee not found')
      }
      locationId = employee.locationId
    }

    // Resolve all three reason types in parallel
    const [voidResult, compResult, discountResult] = await Promise.all([
      resolveAllowedReasonIds(locationId, employeeId, 'void_reason'),
      resolveAllowedReasonIds(locationId, employeeId, 'comp_reason'),
      resolveAllowedReasonIds(locationId, employeeId, 'discount'),
    ])

    // Fetch the actual objects — if no rules configured, return ALL active (backward compat)
    const [voidReasons, compReasons, discountPresets] = await Promise.all([
      voidResult.hasRules
        ? db.voidReason.findMany({
            where: { id: { in: voidResult.ids }, isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
          })
        : db.voidReason.findMany({
            where: { locationId, isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
          }),
      compResult.hasRules
        ? db.compReason.findMany({
            where: { id: { in: compResult.ids }, isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
          })
        : db.compReason.findMany({
            where: { locationId, isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
          }),
      discountResult.hasRules
        ? db.discountRule.findMany({
            where: { id: { in: discountResult.ids }, isActive: true },
            orderBy: [{ priority: 'desc' }, { name: 'asc' }],
          })
        : db.discountRule.findMany({
            where: { locationId, isActive: true },
            orderBy: [{ priority: 'desc' }, { name: 'asc' }],
          }),
    ])

    return ok({
        voidReasons,
        compReasons,
        discountPresets,
      })
  } catch (error) {
    console.error('Employee reasons sync error:', error)
    return err('Failed to fetch employee reasons', 500)
  }
})
