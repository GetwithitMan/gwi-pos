import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// GET /api/inventory/deduction-queue — list pending deductions with summary
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('employeeId')
    const statusFilter = searchParams.get('status') // optional: pending, failed, dead
    const limit = Math.min(Number(searchParams.get('limit')) || 100, 500)

    if (!locationId) {
      return err('Location ID is required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Build filter
    const where: Record<string, unknown> = { locationId }
    if (statusFilter && ['pending', 'processing', 'failed', 'dead'].includes(statusFilter)) {
      where.status = statusFilter
    }

    // Fetch deductions with run count
    const deductions = await db.pendingDeduction.findMany({
      where,
      include: {
        _count: { select: { runs: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })

    // Summary counts — all statuses for this location
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const allDeductions = await db.pendingDeduction.groupBy({
      by: ['status'],
      where: { locationId },
      _count: { id: true },
    })

    const succeededToday = await db.pendingDeduction.count({
      where: {
        locationId,
        status: 'succeeded',
        succeededAt: { gte: today },
      },
    })

    const statusCounts: Record<string, number> = {
      pending: 0,
      processing: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
    }
    for (const g of allDeductions) {
      statusCounts[g.status] = g._count.id
    }

    return ok({
        deductions: deductions.map(d => ({
          id: d.id,
          orderId: d.orderId,
          paymentId: d.paymentId,
          deductionType: d.deductionType,
          status: d.status,
          attempts: d.attempts,
          maxAttempts: d.maxAttempts,
          lastError: d.lastError,
          lastAttemptAt: d.lastAttemptAt?.toISOString() ?? null,
          succeededAt: d.succeededAt?.toISOString() ?? null,
          availableAt: d.availableAt.toISOString(),
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
          runCount: d._count.runs,
        })),
        summary: {
          pending: statusCounts.pending,
          processing: statusCounts.processing,
          succeededToday,
          failed: statusCounts.failed,
          dead: statusCounts.dead,
        },
      })
  } catch (error) {
    console.error('Failed to fetch deduction queue:', error)
    return err('Failed to fetch deduction queue', 500)
  }
})

// POST /api/inventory/deduction-queue — retry a failed/dead deduction
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, action, id, employeeId } = body

    if (!locationId) {
      return err('Location ID is required')
    }
    if (!id) {
      return err('Deduction ID is required')
    }

    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    if (action === 'retry') {
      const deduction = await db.pendingDeduction.findFirst({
        where: { id, locationId },
      })

      if (!deduction) {
        return notFound('Deduction not found')
      }

      if (deduction.status !== 'failed' && deduction.status !== 'dead') {
        return err('Only failed or dead deductions can be retried')
      }

      const updated = await db.pendingDeduction.update({
        where: { id },
        data: {
          status: 'pending',
          availableAt: new Date(),
          lastError: null,
        },
      })

      void notifyDataChanged({ locationId, domain: 'inventory', action: 'updated', entityId: updated.id })
      pushUpstream()

      return ok({ id: updated.id, status: updated.status })
    }

    return err('Unknown action')
  } catch (error) {
    console.error('Failed to update deduction:', error)
    return err('Failed to update deduction', 500)
  }
}))
