import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { retryFailedPrintJobs } from '@/lib/print-retry'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

/**
 * POST /api/print/retry — Trigger retry of queued print jobs for a location.
 * GET  /api/print/retry — List failed/queued print jobs for a location.
 */

// POST - Trigger retry of queued print jobs
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId } = body as { locationId: string }

    if (!locationId) {
      return err('locationId is required')
    }

    const result = await retryFailedPrintJobs(locationId)

    return ok({
        ...result,
        message: `Retried ${result.retried} jobs: ${result.succeeded} succeeded, ${result.failed} failed`,
      })
  } catch (error) {
    console.error('[Print Retry] Error retrying print jobs:', error)
    return err('Failed to retry print jobs', 500)
  }
}))

// GET - List failed/queued print jobs
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status') // 'queued', 'failed', 'failed_permanent', or null (all)
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200))

    if (!locationId) {
      return err('locationId is required')
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (status) {
      where.status = status
    } else {
      // Default: show queued + failed + failed_permanent (not sent/pending)
      where.status = { in: ['queued', 'failed', 'failed_permanent'] }
    }

    const jobs = await db.printJob.findMany({
      where,
      include: {
        printer: {
          select: {
            id: true,
            name: true,
            ipAddress: true,
            isActive: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
            orderType: true,
            tabName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Summary counts
    const counts = await db.printJob.groupBy({
      by: ['status'],
      where: {
        locationId,
        deletedAt: null,
        status: { in: ['queued', 'failed', 'failed_permanent'] },
      },
      _count: { id: true },
    })

    const summary = {
      queued: 0,
      failed: 0,
      failed_permanent: 0,
    }
    for (const c of counts) {
      if (c.status in summary) {
        summary[c.status as keyof typeof summary] = c._count.id
      }
    }

    return ok({
        jobs: jobs.map(job => ({
          id: job.id,
          jobType: job.jobType,
          status: job.status,
          retryCount: job.retryCount,
          errorMessage: job.errorMessage,
          hasContent: !!job.content,
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
          sentAt: job.sentAt?.toISOString() || null,
          printer: job.printer,
          order: job.order,
        })),
        summary,
      })
  } catch (error) {
    console.error('[Print Retry] Error listing print jobs:', error)
    return err('Failed to list print jobs', 500)
  }
})
