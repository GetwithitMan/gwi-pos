import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { retryFailedPrintJobs } from '@/lib/print-retry'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'

/**
 * GET  /api/print/failed-jobs — List failed print jobs for printer status UI
 * POST /api/print/failed-jobs — Retry specific or all failed jobs
 * DELETE /api/print/failed-jobs — Acknowledge (clear) failed_permanent jobs
 */

// GET - List failed print jobs with printer info
export const GET = withVenue(withAuth(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Fetch failed/queued jobs with printer + order details
    const jobs = await db.printJob.findMany({
      where: {
        locationId,
        deletedAt: null,
        status: { in: ['failed', 'failed_permanent', 'queued'] },
      },
      include: {
        printer: {
          select: {
            id: true,
            name: true,
            ipAddress: true,
            port: true,
            isActive: true,
            lastPingOk: true,
            lastPingAt: true,
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
      take: 100,
    })

    // Get all printers for this location with their job counts
    const printers = await db.printer.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        ipAddress: true,
        port: true,
        printerRole: true,
        isActive: true,
        lastPingOk: true,
        lastPingAt: true,
      },
    })

    // Count failed jobs per printer
    const failedCounts = await db.printJob.groupBy({
      by: ['printerId', 'status'],
      where: {
        locationId,
        deletedAt: null,
        status: { in: ['failed', 'failed_permanent', 'queued'] },
      },
      _count: { id: true },
    })

    const printerStatusMap = new Map<string, { pending: number; failed: number; failedPermanent: number }>()
    for (const c of failedCounts) {
      if (!printerStatusMap.has(c.printerId)) {
        printerStatusMap.set(c.printerId, { pending: 0, failed: 0, failedPermanent: 0 })
      }
      const entry = printerStatusMap.get(c.printerId)!
      if (c.status === 'queued') entry.pending += c._count.id
      else if (c.status === 'failed') entry.failed += c._count.id
      else if (c.status === 'failed_permanent') entry.failedPermanent += c._count.id
    }

    // Build printer status list
    const printerStatuses = printers.map(p => {
      const counts = printerStatusMap.get(p.id) || { pending: 0, failed: 0, failedPermanent: 0 }
      const hasFailures = counts.failed > 0 || counts.failedPermanent > 0
      const status = !p.isActive
        ? 'offline' as const
        : hasFailures
          ? 'error' as const
          : counts.pending > 0
            ? 'warning' as const
            : 'online' as const

      return {
        id: p.id,
        name: p.name,
        ipAddress: p.ipAddress,
        port: p.port,
        role: p.printerRole,
        status,
        lastPingOk: p.lastPingOk,
        lastPingAt: p.lastPingAt?.toISOString() || null,
        pendingCount: counts.pending,
        failedCount: counts.failed,
        failedPermanentCount: counts.failedPermanent,
      }
    })

    // Overall health: red if any printer has failures, green otherwise
    const hasAnyFailures = printerStatuses.some(p => p.status === 'error' || p.status === 'offline')

    return NextResponse.json({
      data: {
        health: hasAnyFailures ? 'error' : 'ok',
        printers: printerStatuses,
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
          orderId: job.order?.id || null,
          orderNumber: job.order?.orderNumber || null,
          printerName: job.printer?.name || 'Unknown',
          printerId: job.printer?.id || null,
        })),
        totalFailed: jobs.filter(j => j.status === 'failed' || j.status === 'failed_permanent').length,
        totalPending: jobs.filter(j => j.status === 'queued').length,
      },
    })
  } catch (error) {
    console.error('[Print Failed Jobs] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch print job status' }, { status: 500 })
  }
}))

// POST - Retry failed print jobs (specific IDs or all)
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, jobIds } = body as { locationId: string; jobIds?: string[] }

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    if (jobIds && Array.isArray(jobIds) && jobIds.length > 0) {
      // Retry specific jobs: reset their status to 'queued' and decrement retryCount
      // so retryFailedPrintJobs will pick them up
      await db.printJob.updateMany({
        where: {
          id: { in: jobIds },
          locationId,
          deletedAt: null,
          status: { in: ['failed', 'failed_permanent'] },
        },
        data: {
          status: 'queued',
          retryCount: 0,
          errorMessage: null,
        },
      })
    }

    // Run the retry processor
    const result = await retryFailedPrintJobs(locationId)

    return NextResponse.json({
      data: {
        retried: result.retried,
        succeeded: result.succeeded,
        stillFailed: result.failed,
        message: `Retried ${result.retried} jobs: ${result.succeeded} succeeded, ${result.failed} still failed`,
      },
    })
  } catch (error) {
    console.error('[Print Failed Jobs] POST error:', error)
    return NextResponse.json({ error: 'Failed to retry print jobs' }, { status: 500 })
  }
}))

// DELETE - Acknowledge failed_permanent jobs (soft-delete)
export const DELETE = withVenue(withAuth(async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const jobIds = searchParams.get('jobIds')?.split(',').filter(Boolean)

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      locationId,
      status: 'failed_permanent',
      deletedAt: null,
    }

    if (jobIds && jobIds.length > 0) {
      where.id = { in: jobIds }
    }

    const result = await db.printJob.updateMany({
      where,
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({
      data: {
        acknowledged: result.count,
        message: `Cleared ${result.count} permanently failed print jobs`,
      },
    })
  } catch (error) {
    console.error('[Print Failed Jobs] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to clear print jobs' }, { status: 500 })
  }
}))
