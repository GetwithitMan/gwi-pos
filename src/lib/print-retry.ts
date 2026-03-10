/**
 * Print retry infrastructure.
 *
 * 1. dispatchPrintWithRetry — fire-and-forget HTTP dispatch with 1 retry + audit log
 * 2. retryFailedPrintJobs — batch-retry queued PrintJob records (status: 'queued', retryCount < 3)
 *
 * Usage:
 *   void dispatchPrintWithRetry(url, body, { locationId, employeeId, orderId })
 *   const result = await retryFailedPrintJobs(locationId)
 */

import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'

const MAX_RETRY_COUNT = 3

/**
 * Fire-and-forget print dispatch with single HTTP retry.
 * On failure, retries once after 3s. If both fail, logs to AuditLog.
 */
export async function dispatchPrintWithRetry(
  url: string,
  body: Record<string, unknown>,
  context: { locationId: string; employeeId?: string | null; orderId: string }
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return
    throw new Error(`Print failed: ${res.status}`)
  } catch (firstError) {
    // Retry once after 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000))
    try {
      const retryRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (retryRes.ok) return
      throw new Error(`Print retry failed: ${retryRes.status}`)
    } catch (retryError) {
      console.error('[PRINT-SAFETY] Print failed after retry:', retryError)
      // Log to audit trail so managers can see missed tickets
      void db.auditLog.create({
        data: {
          locationId: context.locationId,
          employeeId: context.employeeId || null,
          action: 'print_job_failed',
          entityType: 'order',
          entityId: context.orderId,
          details: { url, error: String(retryError) },
        },
      }).catch(() => {})
    }
  }
}

/**
 * Retry all queued print jobs for a location.
 *
 * Finds PrintJob records with status 'queued' and retryCount < MAX_RETRY_COUNT,
 * attempts to re-send each one to its printer. Updates status on success/failure.
 * After MAX_RETRY_COUNT failures, marks as 'failed_permanent'.
 */
export async function retryFailedPrintJobs(
  locationId: string
): Promise<{ retried: number; succeeded: number; failed: number }> {
  const queuedJobs = await db.printJob.findMany({
    where: {
      locationId,
      status: 'queued',
      retryCount: { lt: MAX_RETRY_COUNT },
      deletedAt: null,
    },
    include: {
      printer: {
        select: {
          id: true,
          ipAddress: true,
          port: true,
          isActive: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  let succeeded = 0
  let failed = 0

  for (const job of queuedJobs) {
    // Skip jobs whose printer is no longer active
    if (!job.printer.isActive) {
      await db.printJob.update({
        where: { id: job.id },
        data: {
          status: 'failed_permanent',
          errorMessage: 'Printer is no longer active',
        },
      })
      failed++
      continue
    }

    // Skip jobs without stored content (can't reprint)
    if (!job.content) {
      await db.printJob.update({
        where: { id: job.id },
        data: {
          status: 'failed_permanent',
          errorMessage: 'No stored print content for reprint',
        },
      })
      failed++
      continue
    }

    try {
      const buffer = Buffer.from(job.content, 'base64')
      const result = await sendToPrinter(job.printer.ipAddress, job.printer.port, buffer)

      if (result.success) {
        await db.printJob.update({
          where: { id: job.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
            errorMessage: null,
          },
        })
        succeeded++
      } else {
        const newRetryCount = job.retryCount + 1
        const newStatus = newRetryCount >= MAX_RETRY_COUNT ? 'failed_permanent' : 'queued'

        await db.printJob.update({
          where: { id: job.id },
          data: {
            retryCount: newRetryCount,
            status: newStatus as 'queued' | 'failed_permanent',
            errorMessage: result.error || 'Send failed',
          },
        })
        failed++
      }
    } catch (err) {
      const newRetryCount = job.retryCount + 1
      const newStatus = newRetryCount >= MAX_RETRY_COUNT ? 'failed_permanent' : 'queued'

      await db.printJob.update({
        where: { id: job.id },
        data: {
          retryCount: newRetryCount,
          status: newStatus as 'queued' | 'failed_permanent',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      })
      failed++
    }
  }

  return { retried: queuedJobs.length, succeeded, failed }
}
