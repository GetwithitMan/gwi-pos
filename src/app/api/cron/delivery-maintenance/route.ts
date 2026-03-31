import { NextRequest } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { isDeliveryFeatureActive } from '@/lib/delivery/feature-check'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { ok } from '@/lib/api-response'

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
 * Runs per-location per-venue. Skips silently if delivery is not enabled.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const allResults: Record<string, unknown>[] = []

  const summary = await forAllVenues(async (venueDb, slug) => {
    const locations = await venueDb.location.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true },
    })

    for (const loc of locations) {
      const settings = (loc.settings || {}) as Record<string, any>

      // Skip if delivery is not enabled for this location
      if (!isDeliveryFeatureActive(settings)) {
        allResults.push({ slug, locationId: loc.id, skipped: true, reason: 'delivery_not_enabled' })
        continue
      }

      const locationResult: Record<string, unknown> = { slug, locationId: loc.id }

      try {
        // 1. Prune GPS breadcrumbs older than 7 days
        const gpsPruned = await venueDb.$executeRaw`DELETE FROM "DeliveryTracking"
           WHERE "locationId" = ${loc.id}
             AND "recordedAt" < NOW() - INTERVAL '7 days'`
        locationResult.gpsBreadcrumbsPruned = gpsPruned
        if (gpsPruned > 0) {
          console.log(`[cron:delivery-maintenance] Venue ${slug} location ${loc.id}: pruned ${gpsPruned} GPS breadcrumbs`)
        }

        // 2. Flag expiring driver documents (within 14 days)
        const expiringDocs = await venueDb.$queryRaw<any[]>`SELECT dd."id", dd."driverId", dd."documentType", dd."expiresAt"
           FROM "DeliveryDriverDocument" dd
           WHERE dd."expiresAt" < NOW() + INTERVAL '14 days'
             AND dd."expiresAt" > NOW()
             AND dd."deletedAt" IS NULL
             AND EXISTS (
               SELECT 1 FROM "DeliveryDriver" d
               WHERE d."id" = dd."driverId"
                 AND d."locationId" = ${loc.id}
                 AND d."deletedAt" IS NULL
             )`

        let exceptionsCreated = 0
        for (const doc of expiringDocs) {
          const existing = await venueDb.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int as count
             FROM "DeliveryException"
             WHERE "locationId" = ${loc.id}
               AND "type" = 'expiring_document'
               AND "driverId" = ${doc.driverId}
               AND "status" != 'resolved'
               AND "deletedAt" IS NULL
               AND "description" LIKE ${`%${doc.id}%`}`

          if ((existing[0]?.count ?? 0) === 0) {
            const exceptionDescription = `Driver document ${doc.documentType} (${doc.id}) expires ${new Date(doc.expiresAt).toISOString().split('T')[0]}`
            await venueDb.$executeRaw`INSERT INTO "DeliveryException" (
                "id", "locationId", "driverId", "type", "severity", "status",
                "description", "createdAt", "updatedAt"
              ) VALUES (
                gen_random_uuid()::text, ${loc.id}, ${doc.driverId}, 'expiring_document', 'low', 'open',
                ${exceptionDescription}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )`
            exceptionsCreated++
          }
        }
        locationResult.expiringDocumentsFound = expiringDocs.length
        locationResult.exceptionsCreated = exceptionsCreated
        if (expiringDocs.length > 0) {
          console.log(`[cron:delivery-maintenance] Venue ${slug} location ${loc.id}: ${expiringDocs.length} expiring docs, ${exceptionsCreated} new exceptions`)
        }

        // 3. Prune old notification attempts (> 30 days)
        const attemptsPruned = await venueDb.$executeRaw`DELETE FROM "DeliveryNotificationAttempt"
           WHERE "attemptedAt" < NOW() - INTERVAL '30 days'
             AND "notificationId" IN (
               SELECT "id" FROM "DeliveryNotification"
               WHERE "locationId" = ${loc.id}
             )`
        locationResult.notificationAttemptsPruned = attemptsPruned
        if (attemptsPruned > 0) {
          console.log(`[cron:delivery-maintenance] Venue ${slug} location ${loc.id}: pruned ${attemptsPruned} notification attempts`)
        }

        // 4. Clean up expired proof media references (> 90 days)
        const proofsCleared = await venueDb.$executeRaw`UPDATE "DeliveryProofOfDelivery"
           SET "storageKey" = NULL
           WHERE "locationId" = ${loc.id}
             AND "capturedAt" < NOW() - INTERVAL '90 days'
             AND "storageKey" IS NOT NULL`
        locationResult.proofMediaRefsCleared = proofsCleared
        if (proofsCleared > 0) {
          console.log(`[cron:delivery-maintenance] Venue ${slug} location ${loc.id}: cleared ${proofsCleared} expired proof media refs`)
        }

        allResults.push(locationResult)
      } catch (locErr) {
        console.error(`[cron:delivery-maintenance] Venue ${slug} location ${loc.id} error:`, locErr)
        allResults.push({
          slug,
          locationId: loc.id,
          error: locErr instanceof Error ? locErr.message : 'Unknown error',
        })
      }
    }
  }, { label: 'cron:delivery-maintenance' })

  return ok({
    ...summary,
    processed: allResults,
    timestamp: now.toISOString(),
  })
}
