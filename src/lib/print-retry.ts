/**
 * W2-O2: Print dispatch with single retry on failure.
 *
 * Replaces bare `fetch(...).catch(() => {})` patterns for server-side
 * print dispatches. On failure, retries once after 3s. If both attempts
 * fail, logs to AuditLog so managers can see missed tickets.
 *
 * Usage (always fire-and-forget — never await):
 *   void dispatchPrintWithRetry(url, body, { locationId, employeeId, orderId })
 */

import { db } from '@/lib/db'

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
