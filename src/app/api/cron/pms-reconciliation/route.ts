import { NextRequest } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { ok } from '@/lib/api-response'

/**
 * GET /api/cron/pms-reconciliation
 *
 * Safety-net cron that detects orphaned Oracle OPERA room charges where the
 * PmsChargeAttempt succeeded (status='COMPLETED', operaTransactionId set) but
 * no matching Payment record was created (DB transaction failed after the
 * charge went through at OPERA).
 *
 * This cron does NOT auto-create Payment records — that is too risky without
 * human verification. Instead it:
 *   1. Detects orphaned charges
 *   2. Creates an AuditLog with action='pms_charge_orphaned'
 *   3. Logs at CRITICAL level for monitoring/alerting
 *
 * Auth: Vercel CRON_SECRET via Bearer token
 * Schedule: Every hour (configure in vercel.json)
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface OrphanedCharge {
  id: string
  orderId: string
  locationId: string
  reservationId: string
  amountCents: number
  chargeCode: string
  operaTransactionId: string
  createdAt: Date
}

interface VenueResult {
  slug: string
  orphansFound: number
  auditLogsCreated: number
  errors: string[]
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const allResults: VenueResult[] = []

  const summary = await forAllVenues(async (venueDb, slug) => {
    // Find PmsChargeAttempt records that completed at OPERA but have no matching Payment.
    // A charge is "orphaned" when:
    //   - status = 'COMPLETED' (OPERA accepted the charge)
    //   - operaTransactionId IS NOT NULL (we got a transaction ID back)
    //   - No Payment exists with pmsTransactionId = attempt.operaTransactionId
    let orphans: OrphanedCharge[]
    try {
      orphans = await venueDb.$queryRawUnsafe<OrphanedCharge[]>(
        `SELECT pca.id, pca."orderId", pca."locationId", pca."reservationId",
                pca."amountCents", pca."chargeCode", pca."operaTransactionId",
                pca."createdAt"
         FROM "PmsChargeAttempt" pca
         WHERE pca."status" = 'COMPLETED'
           AND pca."operaTransactionId" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM "Payment" p
             WHERE p."pmsTransactionId" = pca."operaTransactionId"
               AND p."deletedAt" IS NULL
           )
         ORDER BY pca."createdAt" ASC
         LIMIT 100`
      )
    } catch (error) {
      // Table may not exist yet (migration not run) -- not an error
      const msg = error instanceof Error ? error.message : String(error)
      if (
        msg.includes('PmsChargeAttempt') ||
        msg.includes('does not exist') ||
        msg.includes('relation') && msg.includes('does not exist')
      ) {
        return // Silently skip venues without PMS tables
      }
      throw error
    }

    if (orphans.length === 0) return

    const result: VenueResult = {
      slug,
      orphansFound: orphans.length,
      auditLogsCreated: 0,
      errors: [],
    }

    console.error(
      `[PMS-RECONCILIATION] CRITICAL: ${orphans.length} orphaned PMS charge(s) found for venue ${slug}. ` +
      `IDs: ${orphans.map(o => o.id).join(', ')}. ` +
      `OPERA TxnIDs: ${orphans.map(o => o.operaTransactionId).join(', ')}`
    )

    for (const orphan of orphans) {
      try {
        // Check if the order still exists and is not already fully paid
        const orderCheck = await venueDb.$queryRawUnsafe<Array<{ id: string; status: string; total: unknown }>>(
          `SELECT id, status, total FROM "Order" WHERE id = $1 AND "deletedAt" IS NULL`,
          orphan.orderId
        )

        const orderExists = orderCheck.length > 0
        const orderStatus = orderCheck[0]?.status ?? 'unknown'
        const orderTotal = orderCheck[0]?.total != null ? Number(orderCheck[0].total) : null

        // Check if a payment was already created (race condition guard — another
        // process may have reconciled it between our initial query and now)
        const existingPayment = await venueDb.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM "Payment"
           WHERE "pmsTransactionId" = $1 AND "deletedAt" IS NULL
           LIMIT 1`,
          orphan.operaTransactionId
        )

        if (existingPayment.length > 0) {
          // Payment was created since our initial query — no longer orphaned
          continue
        }

        // Create an AuditLog entry for human review
        await venueDb.$executeRawUnsafe(
          `INSERT INTO "AuditLog" (id, "locationId", action, "entityType", "entityId", details, "createdAt", "updatedAt")
           VALUES (
             gen_random_uuid()::text,
             $1,
             'pms_charge_orphaned',
             'PmsChargeAttempt',
             $2,
             $3::jsonb,
             NOW(),
             NOW()
           )`,
          orphan.locationId,
          orphan.id,
          JSON.stringify({
            message: 'OPERA room charge completed but no Payment record exists. Requires manual reconciliation.',
            pmsChargeAttemptId: orphan.id,
            orderId: orphan.orderId,
            reservationId: orphan.reservationId,
            operaTransactionId: orphan.operaTransactionId,
            amountCents: orphan.amountCents,
            chargeCode: orphan.chargeCode,
            chargeCreatedAt: orphan.createdAt,
            orderExists,
            orderStatus,
            orderTotal,
            detectedAt: new Date().toISOString(),
          }),
        )

        result.auditLogsCreated++

        console.error(
          `[PMS-RECONCILIATION] Orphaned charge logged: attempt=${orphan.id} ` +
          `order=${orphan.orderId} operaTxn=${orphan.operaTransactionId} ` +
          `amount=${orphan.amountCents}c orderExists=${orderExists} orderStatus=${orderStatus}`
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[PMS-RECONCILIATION] Failed to process orphan ${orphan.id}:`, msg)
        result.errors.push(`${orphan.id}: ${msg.slice(0, 150)}`)
      }
    }

    allResults.push(result)
  }, { label: 'cron:pms-reconciliation', concurrency: 3 })

  const totalOrphans = allResults.reduce((n, r) => n + r.orphansFound, 0)
  const totalLogs = allResults.reduce((n, r) => n + r.auditLogsCreated, 0)

  return ok({
    ...summary,
    orphansFound: totalOrphans,
    auditLogsCreated: totalLogs,
    reconciliation: allResults,
    timestamp: new Date().toISOString(),
  })
}
