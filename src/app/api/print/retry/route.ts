import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { retryFailedPrintJobs } from '@/lib/print-retry'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'

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
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    const result = await retryFailedPrintJobs(locationId)

    return NextResponse.json({
      data: {
        ...result,
        message: `Retried ${result.retried} jobs: ${result.succeeded} succeeded, ${result.failed} failed`,
      },
    })
  } catch (error) {
    console.error('[Print Retry] Error retrying print jobs:', error)
    return NextResponse.json(
      { error: 'Failed to retry print jobs' },
      { status: 500 }
    )
  }
}))

// GET - List failed/queued print jobs
export const GET = withVenue(withAuth(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status') // 'queued', 'failed', 'failed_permanent', or null (all)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
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

    return NextResponse.json({
      data: {
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
      },
    })
  } catch (error) {
    console.error('[Print Retry] Error listing print jobs:', error)
    return NextResponse.json(
      { error: 'Failed to list print jobs' },
      { status: 500 }
    )
  }
}))
