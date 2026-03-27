/**
 * Print retry infrastructure.
 *
 * 1. dispatchPrintWithRetry — durable print dispatch: creates PrintJob BEFORE sending,
 *    updates status on success/failure. On crash, stale 'queued' jobs are recovered.
 * 2. retryFailedPrintJobs — batch-retry queued PrintJob records (status: 'queued', retryCount < 3)
 * 3. recoverStalePrintJobs — on NUC restart, retries jobs stuck in 'queued' > 30s
 *
 * When a job hits MAX_RETRY_COUNT, attemptBackupForJob tries:
 *   1. A configured backup printer on the same PrintRoute
 *   2. Any other active printer with the same role
 * If no backup succeeds, marks as 'failed_permanent' and dispatches an alert.
 *
 * Usage:
 *   void dispatchPrintWithRetry(url, body, { locationId, employeeId, orderId, printerId })
 *   const result = await retryFailedPrintJobs(locationId)
 *   void recoverStalePrintJobs(locationId)
 */

import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import { dispatchPrintJobFailed } from '@/lib/socket-dispatch'
import { dispatchAlert } from '@/lib/alert-service'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('print-retry')

const MAX_RETRY_COUNT = 3
const STALE_JOB_THRESHOLD_MS = 30_000 // 30 seconds — jobs older than this are considered crash orphans

/**
 * Durable print dispatch with single HTTP retry.
 *
 * Creates a PrintJob record BEFORE the first send attempt so that a NUC crash
 * between order-send and print-HTTP never silently drops a kitchen ticket.
 * On success the job moves to 'sent'. On failure after retry, the job stays
 * 'queued' for `retryFailedPrintJobs` to pick up, and a socket broadcast
 * notifies terminals of the offline printer.
 */
export async function dispatchPrintWithRetry(
  url: string,
  body: Record<string, unknown>,
  context: {
    locationId: string
    employeeId?: string | null
    orderId: string
    printerId?: string | null
  }
): Promise<void> {
  // ── Step 1: Create durable PrintJob record BEFORE sending ──────────────────
  // PrintJob requires a valid printerId (FK to Printer). If the caller doesn't
  // provide one, we fall back to AuditLog-only durability (still better than nothing).
  let printJobId: string | null = null
  if (context.printerId) {
    try {
      const printJob = await db.printJob.create({
        data: {
          locationId: context.locationId,
          jobType: 'kitchen_ticket',
          orderId: context.orderId,
          printerId: context.printerId,
          status: 'queued',
          retryCount: 0,
          errorMessage: null,
          content: null, // HTTP dispatch path — content is rebuilt by the print route
        },
      })
      printJobId = printJob.id
    } catch (dbErr) {
      // If we can't persist the job, fall through to best-effort send anyway.
      // This matches the old fire-and-forget behavior as a degraded fallback.
      log.warn({ err: dbErr }, '[PRINT-SAFETY] Could not create PrintJob record — proceeding best-effort')
    }
  } else {
    // No printerId — log to AuditLog as a pre-send breadcrumb so we can detect
    // crash-orphaned prints even without a PrintJob record.
    void db.auditLog.create({
      data: {
        locationId: context.locationId,
        employeeId: context.employeeId || null,
        action: 'print_job_queued',
        entityType: 'order',
        entityId: context.orderId,
        details: { url, note: 'Pre-send breadcrumb (no printerId for PrintJob)' },
      },
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in print-retry'))
  }

  // ── Step 2: First send attempt ─────────────────────────────────────────────
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      // Mark job as completed
      if (printJobId) {
        void db.printJob.update({
          where: { id: printJobId },
          data: { status: 'sent', sentAt: new Date(), errorMessage: null },
        }).catch(err => log.warn({ err }, 'fire-and-forget failed in print-retry'))
      }
      return
    }
    throw new Error(`Print failed: ${res.status}`)
  } catch (firstError) {
    // ── Step 3: Retry once after 3 seconds ─────────────────────────────────
    await new Promise(resolve => setTimeout(resolve, 3000))
    try {
      const retryRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (retryRes.ok) {
        if (printJobId) {
          void db.printJob.update({
            where: { id: printJobId },
            data: { status: 'sent', sentAt: new Date(), errorMessage: null },
          }).catch(err => log.warn({ err }, 'fire-and-forget failed in print-retry'))
        }
        return
      }
      throw new Error(`Print retry failed: ${retryRes.status}`)
    } catch (retryError) {
      const errorMsg = retryError instanceof Error ? retryError.message : String(retryError)
      log.error({ err: retryError }, '[PRINT-SAFETY] Print failed after retry:')

      // ── Step 4: Leave job as 'queued' for retryFailedPrintJobs to pick up ─
      if (printJobId) {
        void db.printJob.update({
          where: { id: printJobId },
          data: {
            retryCount: 1,
            status: 'queued',
            errorMessage: errorMsg,
          },
        }).catch(err => log.warn({ err }, 'fire-and-forget failed in print-retry'))
      }

      // Also log to audit trail so managers can see missed tickets
      void db.auditLog.create({
        data: {
          locationId: context.locationId,
          employeeId: context.employeeId || null,
          action: 'print_job_failed',
          entityType: 'order',
          entityId: context.orderId,
          details: { url, error: errorMsg, printJobId },
        },
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in print-retry'))

      // ── Step 5: Notify terminals that printer may be offline ─────────────
      void dispatchPrintJobFailed(context.locationId, {
        orderId: context.orderId,
        printerName: context.printerId ? 'unknown' : 'unresolved',
        printerId: context.printerId || undefined,
        error: `Print dispatch failed after retry: ${errorMsg}`,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in print-retry'))
    }
  }
}

/**
 * Recover print jobs orphaned by a NUC crash.
 *
 * Finds PrintJob records with status='queued' that are older than 30 seconds
 * (indicating the process that created them died before completing the send).
 * Feeds them back into retryFailedPrintJobs for normal retry processing.
 *
 * Call this on NUC startup / app boot.
 */
export async function recoverStalePrintJobs(
  locationId: string
): Promise<{ recovered: number }> {
  const staleThreshold = new Date(Date.now() - STALE_JOB_THRESHOLD_MS)

  const staleJobs = await db.printJob.findMany({
    where: {
      locationId,
      status: 'queued',
      retryCount: { lt: MAX_RETRY_COUNT },
      createdAt: { lt: staleThreshold },
      deletedAt: null,
    },
    select: { id: true, orderId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  if (staleJobs.length === 0) return { recovered: 0 }

  log.info(
    { count: staleJobs.length, locationId },
    '[PRINT-RECOVERY] Found stale print jobs after restart — feeding into retry pipeline'
  )

  // Reset retryCount so retryFailedPrintJobs will pick them up fresh
  await db.printJob.updateMany({
    where: { id: { in: staleJobs.map(j => j.id) } },
    data: { retryCount: 0, errorMessage: 'Recovered after NUC restart' },
  })

  // Run the retry pipeline immediately
  const result = await retryFailedPrintJobs(locationId)

  log.info(
    { ...result, locationId },
    '[PRINT-RECOVERY] Stale print job recovery complete'
  )

  return { recovered: staleJobs.length }
}

/**
 * Retry all queued print jobs for a location.
 *
 * Finds PrintJob records with status 'queued' and retryCount < MAX_RETRY_COUNT,
 * attempts to re-send each one to its printer. Updates status on success/failure.
 * After MAX_RETRY_COUNT failures, attempts backup printer routing before marking
 * as 'failed_permanent'.
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
          name: true,
          ipAddress: true,
          port: true,
          isActive: true,
          printerRole: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  let succeeded = 0
  let failed = 0

  for (const job of queuedJobs) {
    // Skip jobs whose printer is no longer active — try backup
    if (!job.printer.isActive) {
      const backupOk = await attemptBackupForJob(job, locationId, 'Printer is no longer active')
      if (backupOk) {
        succeeded++
      } else {
        await db.printJob.update({
          where: { id: job.id },
          data: {
            status: 'failed_permanent',
            errorMessage: 'Printer is no longer active, no backup available',
          },
        })
        failed++
      }
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

        if (newRetryCount >= MAX_RETRY_COUNT) {
          // Max retries exhausted — attempt backup printer
          const backupOk = await attemptBackupForJob(job, locationId, result.error || 'Send failed')
          if (backupOk) {
            succeeded++
          } else {
            await db.printJob.update({
              where: { id: job.id },
              data: {
                retryCount: newRetryCount,
                status: 'failed_permanent',
                errorMessage: result.error || 'Send failed — no backup available',
              },
            })

            // Emit socket event + alert for permanent failure
            void emitPermanentFailure(locationId, job).catch((err) => log.error({ err }, 'emitPermanentFailure failed'))

            failed++
          }
        } else {
          await db.printJob.update({
            where: { id: job.id },
            data: {
              retryCount: newRetryCount,
              status: 'queued',
              errorMessage: result.error || 'Send failed',
            },
          })
          failed++
        }
      }
    } catch (err) {
      const newRetryCount = job.retryCount + 1
      const errorMsg = err instanceof Error ? err.message : String(err)

      if (newRetryCount >= MAX_RETRY_COUNT) {
        const backupOk = await attemptBackupForJob(job, locationId, errorMsg)
        if (backupOk) {
          succeeded++
        } else {
          await db.printJob.update({
            where: { id: job.id },
            data: {
              retryCount: newRetryCount,
              status: 'failed_permanent',
              errorMessage: errorMsg + ' — no backup available',
            },
          })
          void emitPermanentFailure(locationId, job).catch((err) => log.error({ err }, 'emitPermanentFailure failed'))
          failed++
        }
      } else {
        await db.printJob.update({
          where: { id: job.id },
          data: {
            retryCount: newRetryCount,
            status: 'queued',
            errorMessage: errorMsg,
          },
        })
        failed++
      }
    }
  }

  return { retried: queuedJobs.length, succeeded, failed }
}

/**
 * Attempt to route a failed job to a backup printer.
 *
 * Strategy 1: Find a PrintRoute whose primary printer matches, and use its backup.
 * Strategy 2: Find any other active printer with the same role at this location.
 *
 * On success: marks original job as 'sent' with a note about backup routing.
 * Returns true if backup succeeded.
 */
async function attemptBackupForJob(
  job: {
    id: string
    content: string | null
    orderId: string | null
    printer: { id: string; name: string; ipAddress: string; port: number; printerRole: string }
  },
  locationId: string,
  primaryError: string
): Promise<boolean> {
  if (!job.content) return false

  const buffer = Buffer.from(job.content, 'base64')

  try {
    // Strategy 1: Configured backup via PrintRoute
    const route = await db.printRoute.findFirst({
      where: {
        locationId,
        printerId: job.printer.id,
        backupPrinterId: { not: null },
        deletedAt: null,
      },
      include: {
        backupPrinter: {
          select: { id: true, name: true, ipAddress: true, port: true, isActive: true },
        },
      },
    })

    if (route?.backupPrinter?.isActive) {
      const backup = route.backupPrinter
      log.info(`[PrintRetry] Trying backup printer "${backup.name}" for job ${job.id}`)
      const result = await sendToPrinter(backup.ipAddress, backup.port, buffer)
      if (result.success) {
        await db.printJob.update({
          where: { id: job.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
            errorMessage: `Routed to backup: ${backup.name} (primary: ${primaryError})`,
          },
        })
        return true
      }
      log.warn(`[PrintRetry] Backup "${backup.name}" also failed: ${result.error}`)
    }

    // Strategy 2: Any other active printer with same role
    const altPrinter = await db.printer.findFirst({
      where: {
        locationId,
        printerRole: job.printer.printerRole as 'kitchen' | 'bar' | 'receipt',
        isActive: true,
        deletedAt: null,
        id: { not: job.printer.id },
      },
      select: { id: true, name: true, ipAddress: true, port: true },
    })

    if (altPrinter) {
      log.info(`[PrintRetry] Trying alternate printer "${altPrinter.name}" for job ${job.id}`)
      const result = await sendToPrinter(altPrinter.ipAddress, altPrinter.port, buffer)
      if (result.success) {
        await db.printJob.update({
          where: { id: job.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
            errorMessage: `Routed to fallback: ${altPrinter.name} (primary: ${primaryError})`,
          },
        })
        return true
      }
      log.warn(`[PrintRetry] Alternate "${altPrinter.name}" also failed: ${result.error}`)
    }

    return false
  } catch (err) {
    log.error({ err: err }, '[PrintRetry] Backup routing failed:')
    return false
  }
}

/**
 * Emit socket event + alert when a print job becomes permanently failed.
 */
async function emitPermanentFailure(
  locationId: string,
  job: { id: string; orderId: string | null; printer: { name: string; id: string } }
): Promise<void> {
  void dispatchPrintJobFailed(locationId, {
    orderId: job.orderId || job.id,
    printerName: job.printer.name,
    printerId: job.printer.id,
    error: 'Permanently failed after max retries, no backup available',
  }, { async: true }).catch((err) => log.error({ err }, 'operation failed'))

  void dispatchAlert({
    severity: 'HIGH',
    errorType: 'printer_failure',
    category: 'hardware',
    message: `Kitchen printer "${job.printer.name}" permanently failed for job ${job.id}. No backup printer available.`,
    locationId,
    orderId: job.orderId || undefined,
    groupId: `printer-fail-${job.printer.id}`,
  }).catch((err) => log.error({ err }, 'operation failed'))
}
