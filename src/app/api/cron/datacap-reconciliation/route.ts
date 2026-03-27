import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'

/**
 * GET /api/cron/datacap-reconciliation
 *
 * Safety-net cron that detects orphaned Datacap pending sales and attempts
 * to auto-void them via VoidSaleByRecordNo. Orphans occur when the POS server
 * dies between sending a sale to Datacap and recording the result.
 *
 * Flow:
 *   1. Find _pending_datacap_sales WHERE status='pending' AND createdAt < NOW() - 5 min
 *   2. For each orphan with a datacapRecordNo, attempt VoidSaleByRecordNo
 *   3. Mark as 'voided' on success, 'orphaned' on failure (for manual review)
 *   4. Log results at CRITICAL level
 *
 * Auth: Vercel CRON_SECRET via Bearer token
 * Schedule: Every 5 minutes (configure in vercel.json)
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface OrphanRow {
  id: string
  orderId: string
  terminalId: string
  amount: unknown
  datacapRecordNo: string | null
  datacapRefNumber: string | null
  locationId: string
  createdAt: Date
}

interface ReconciliationResult {
  slug: string
  locationId: string
  orphansFound: number
  voided: number
  markedOrphaned: number
  errors: string[]
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const allResults: ReconciliationResult[] = []

  const summary = await forAllVenues(async (venueDb, slug) => {
    // Find stale pending sales older than 5 minutes
    let orphans: OrphanRow[]
    try {
      orphans = await venueDb.$queryRawUnsafe<OrphanRow[]>(
        `SELECT id, "orderId", "terminalId", amount, "datacapRecordNo", "datacapRefNumber", "locationId", "createdAt"
         FROM "_pending_datacap_sales"
         WHERE "status" = 'pending'
           AND "createdAt" < NOW() - INTERVAL '5 minutes'
         ORDER BY "createdAt" ASC
         LIMIT 50`
      )
    } catch (error) {
      // Table may not exist yet (migration not run) -- not an error
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('_pending_datacap_sales') || msg.includes('does not exist')) {
        return // Silently skip venues without the table
      }
      throw error
    }

    if (orphans.length === 0) return

    const locationId = orphans[0]?.locationId || 'unknown'
    const result: ReconciliationResult = {
      slug,
      locationId,
      orphansFound: orphans.length,
      voided: 0,
      markedOrphaned: 0,
      errors: [],
    }

    console.error(
      `[DATACAP-RECONCILIATION] CRITICAL: ${orphans.length} orphaned pending sale(s) found for venue ${slug}. ` +
      `IDs: ${orphans.map(o => o.id).join(', ')}. ` +
      `RecordNos: ${orphans.map(o => o.datacapRecordNo || 'none').join(', ')}`
    )

    for (const orphan of orphans) {
      // Attempt void if we have a recordNo from Datacap
      if (orphan.datacapRecordNo) {
        try {
          // Idempotency check: re-read current status to ensure it hasn't been
          // voided by a concurrent cron run (prevents double-void if DB update
          // failed after a successful void on the previous run).
          const currentStatus = await venueDb.$queryRawUnsafe<Array<{ status: string }>>(
            `SELECT "status" FROM "_pending_datacap_sales" WHERE id = $1`,
            orphan.id
          )
          if (currentStatus.length === 0 || currentStatus[0].status !== 'pending') {
            // Already processed (voided/orphaned) by a concurrent run — skip
            continue
          }

          // Lazy-import Datacap helpers to avoid loading when not needed
          const { getDatacapClient } = await import('@/lib/datacap/helpers')

          // Find an active payment reader for this location to route the void through
          const reader = await venueDb.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM "PaymentReader" WHERE "locationId" = $1 AND "isActive" = true LIMIT 1`,
            orphan.locationId
          )

          if (reader.length === 0) {
            // No active reader -- mark as orphaned for manual review
            await venueDb.$executeRawUnsafe(
              `UPDATE "_pending_datacap_sales" SET "status" = 'orphaned' WHERE id = $1`,
              orphan.id
            )
            result.markedOrphaned++
            result.errors.push(`${orphan.id}: no active payment reader`)
            continue
          }

          // Claim this orphan atomically before sending void to Datacap.
          // CAS (compare-and-swap): only update if still 'pending'. If another
          // cron run already claimed it, rowCount will be 0 and we skip.
          const claimed = await venueDb.$executeRawUnsafe(
            `UPDATE "_pending_datacap_sales" SET "status" = 'voiding' WHERE id = $1 AND "status" = 'pending'`,
            orphan.id
          )
          if (claimed === 0) {
            // Another cron run already claimed this orphan — skip
            continue
          }

          const client = await getDatacapClient(orphan.locationId)
          const voidResponse = await client.voidSale(reader[0].id, {
            recordNo: orphan.datacapRecordNo,
          })

          const isSuccess = voidResponse.cmdStatus === 'Success' || voidResponse.cmdStatus === 'Approved'

          if (isSuccess) {
            await venueDb.$executeRawUnsafe(
              `UPDATE "_pending_datacap_sales" SET "status" = 'voided', "resolvedAt" = NOW() WHERE id = $1`,
              orphan.id
            )
            result.voided++
            console.log(`[DATACAP-RECONCILIATION] Voided orphan ${orphan.id} (recordNo: ${orphan.datacapRecordNo})`)
          } else {
            // Void failed (already settled, etc.) -- mark as orphaned for manual review
            await venueDb.$executeRawUnsafe(
              `UPDATE "_pending_datacap_sales" SET "status" = 'orphaned' WHERE id = $1`,
              orphan.id
            )
            result.markedOrphaned++
            result.errors.push(`${orphan.id}: void declined - ${voidResponse.textResponse || voidResponse.cmdStatus || 'unknown'}`)
          }
        } catch (voidError) {
          // Void attempt failed -- mark as orphaned so it surfaces in the manual endpoint.
          // Do NOT retry the void — the void may have succeeded at Datacap but our DB
          // update failed. Marking as orphaned prevents double-voiding on next cron run.
          const msg = voidError instanceof Error ? voidError.message : String(voidError)
          console.error(`[DATACAP-RECONCILIATION] Void failed for ${orphan.id}:`, msg)

          try {
            await venueDb.$executeRawUnsafe(
              `UPDATE "_pending_datacap_sales" SET "status" = 'orphaned' WHERE id = $1`,
              orphan.id
            )
          } catch { /* best effort */ }

          result.markedOrphaned++
          result.errors.push(`${orphan.id}: ${msg.slice(0, 100)}`)
        }
      } else {
        // No recordNo -- Datacap never responded. Mark as orphaned for manual review.
        try {
          await venueDb.$executeRawUnsafe(
            `UPDATE "_pending_datacap_sales" SET "status" = 'orphaned' WHERE id = $1`,
            orphan.id
          )
        } catch { /* best effort */ }

        result.markedOrphaned++
        result.errors.push(`${orphan.id}: no datacapRecordNo`)
      }
    }

    allResults.push(result)
  }, { label: 'cron:datacap-reconciliation', concurrency: 3 })

  return NextResponse.json({
    ...summary,
    reconciliation: allResults,
    timestamp: new Date().toISOString(),
  })
}
