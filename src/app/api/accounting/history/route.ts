import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

/**
 * GET /api/accounting/history?locationId=xxx&limit=50&offset=0
 *
 * List past accounting exports from the audit log.
 * Returns: date, format, exportedAt, exportedBy, entryCount, totalDebits, isBalanced
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200))
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

    if (!locationId) {
      return err('locationId query parameter is required')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.REPORTS_SALES)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Query audit log for accounting exports
    const [exports, totalCount] = await Promise.all([
      db.auditLog.findMany({
        where: {
          locationId,
          action: 'accounting_export',
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          createdAt: true,
          employeeId: true,
          details: true,
          employee: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      }),
      db.auditLog.count({
        where: {
          locationId,
          action: 'accounting_export',
          deletedAt: null,
        },
      }),
    ])

    const history = exports.map(exp => {
      const details = (exp.details as Record<string, unknown>) || {}
      const employeeName = exp.employee?.displayName
        || (exp.employee ? `${exp.employee.firstName} ${exp.employee.lastName}` : 'System')

      return {
        id: exp.id,
        date: details.date as string || '',
        format: details.format as string || '',
        exportedAt: exp.createdAt.toISOString(),
        exportedBy: employeeName,
        entryCount: (details.entryCount as number) || 0,
        totalDebits: (details.totalDebits as number) || 0,
        totalCredits: (details.totalCredits as number) || 0,
        isBalanced: (details.isBalanced as boolean) ?? true,
      }
    })

    return ok({
        history,
        total: totalCount,
        limit,
        offset,
      })
  } catch (error) {
    console.error('[Accounting History] Failed:', error)
    return err('Failed to fetch export history', 500)
  }
})
