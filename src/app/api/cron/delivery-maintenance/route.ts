import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'
import { isDeliveryFeatureActive } from '@/lib/delivery/feature-check'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/delivery-maintenance
 *
 * Periodic maintenance tasks for the delivery module:
 *  1. Prune GPS breadcrumbs older than 7 days
 *  2. Flag expiring driver documents (within 14 days)
 *  3. Prune old notification attempts (> 30 days)
 *  4. Clean up expired proof media references (> 90 days)
 *
 * Runs per-location. Skips silently if delivery is not enabled.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const results: Record<string, unknown>[] = []

  try {
    const locations = await db.location.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true },
    })

    for (const loc of locations) {
      const settings = (loc.settings || {}) as Record<string, any>

      // Skip if delivery is not enabled for this location
      if (!isDeliveryFeatureActive(settings)) {
        results.push({ locationId: loc.id, skipped: true, reason: 'delivery_not_enabled' })
        continue
      }

      const locationResult: Record<string, unknown> = { locationId: loc.id }

      try {
        // ── 1. Prune GPS breadcrumbs older than 7 days ────────────────
        const gpsPruned = await db.$executeRawUnsafe(
          `DELETE FROM "DeliveryTracking"
           WHERE "locationId" = $1
             AND "recordedAt" < NOW() - INTERVAL '7 days'`,
          loc.id,
        )
        locationResult.gpsBreadcrumbsPruned = gpsPruned
        if (gpsPruned > 0) {
          console.log(`[delivery-maintenance] Location ${loc.id}: pruned ${gpsPruned} GPS breadcrumbs`)
        }

        // ── 2. Flag expiring driver documents (within 14 days) ────────
        const expiringDocs = await db.$queryRawUnsafe<any[]>(
          `SELECT dd."id", dd."driverId", dd."documentType", dd."expiresAt"
           FROM "DeliveryDriverDocument" dd
           WHERE dd."expiresAt" < NOW() + INTERVAL '14 days'
             AND dd."expiresAt" > NOW()
             AND dd."deletedAt" IS NULL
             AND EXISTS (
               SELECT 1 FROM "DeliveryDriver" d
               WHERE d."id" = dd."driverId"
                 AND d."locationId" = $1
                 AND d."deletedAt" IS NULL
             )`,
          loc.id,
        )

        let exceptionsCreated = 0
        for (const doc of expiringDocs) {
          // Only create exception if one doesn't already exist for this document
          const existing = await db.$queryRawUnsafe<{ count: number }[]>(
            `SELECT COUNT(*)::int as count
             FROM "DeliveryException"
             WHERE "locationId" = $1
               AND "type" = 'expiring_document'
               AND "driverId" = $2
               AND "status" != 'resolved'
               AND "deletedAt" IS NULL
               AND "description" LIKE $3`,
            loc.id,
            doc.driverId,
            `%${doc.id}%`,
          )

          if ((existing[0]?.count ?? 0) === 0) {
            await db.$executeRawUnsafe(
              `INSERT INTO "DeliveryException" (
                "id", "locationId", "driverId", "type", "severity", "status",
                "description", "createdAt", "updatedAt"
              ) VALUES (
                gen_random_uuid()::text, $1, $2, 'expiring_document', 'low', 'open',
                $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )`,
              loc.id,
              doc.driverId,
              `Driver document ${doc.documentType} (${doc.id}) expires ${new Date(doc.expiresAt).toISOString().split('T')[0]}`,
            )
            exceptionsCreated++
          }
        }
        locationResult.expiringDocumentsFound = expiringDocs.length
        locationResult.exceptionsCreated = exceptionsCreated
        if (expiringDocs.length > 0) {
          console.log(`[delivery-maintenance] Location ${loc.id}: ${expiringDocs.length} expiring docs, ${exceptionsCreated} new exceptions`)
        }

        // ── 3. Prune old notification attempts (> 30 days) ────────────
        const attemptsPruned = await db.$executeRawUnsafe(
          `DELETE FROM "DeliveryNotificationAttempt"
           WHERE "attemptedAt" < NOW() - INTERVAL '30 days'
             AND "notificationId" IN (
               SELECT "id" FROM "DeliveryNotification"
               WHERE "locationId" = $1
             )`,
          loc.id,
        )
        locationResult.notificationAttemptsPruned = attemptsPruned
        if (attemptsPruned > 0) {
          console.log(`[delivery-maintenance] Location ${loc.id}: pruned ${attemptsPruned} notification attempts`)
        }

        // ── 4. Clean up expired proof media references (> 90 days) ────
        const proofsCleared = await db.$executeRawUnsafe(
          `UPDATE "DeliveryProofOfDelivery"
           SET "storageKey" = NULL
           WHERE "locationId" = $1
             AND "capturedAt" < NOW() - INTERVAL '90 days'
             AND "storageKey" IS NOT NULL`,
          loc.id,
        )
        locationResult.proofMediaRefsCleared = proofsCleared
        if (proofsCleared > 0) {
          console.log(`[delivery-maintenance] Location ${loc.id}: cleared ${proofsCleared} expired proof media refs`)
        }

        results.push(locationResult)
      } catch (locErr) {
        console.error(`[delivery-maintenance] Error processing location ${loc.id}:`, locErr)
        results.push({
          locationId: loc.id,
          error: locErr instanceof Error ? locErr.message : 'Unknown error',
        })
      }
    }

    return NextResponse.json({
      ok: true,
      processed: results,
      timestamp: now.toISOString(),
    })
  } catch (err) {
    console.error('[delivery-maintenance] Fatal error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
