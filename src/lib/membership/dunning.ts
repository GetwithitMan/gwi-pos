/**
 * Membership dunning — expires memberships that have exhausted all retry attempts.
 * Called by the /api/cron/membership-billing cron route after billing processor runs.
 *
 * Finds memberships where:
 *   - billingStatus is retry_scheduled or past_due
 *   - failedAttempts >= 3 (retry schedule exhausted)
 *   - lastFailedAt + gracePeriodDays has passed
 *
 * Transitions them to expired + uncollectible.
 *
 * NOTE: Uses $queryRawUnsafe/$executeRawUnsafe for raw SQL membership tables.
 * All queries use positional $1/$2 params — safe from injection.
 */
import { MembershipEventType } from './types'

interface DunningResult {
  expired: number
}

export async function processDunning(
  locationId: string,
  db: any,
  gracePeriodDays: number = 14
): Promise<DunningResult> {
  // Find memberships that have exhausted all retries and exceeded grace period
  const candidates: Array<{ id: string; locationId: string; failedAttempts: number; lastFailReason: string | null }> =
    await db.$queryRawUnsafe(`
      SELECT "id", "locationId", "failedAttempts", "lastFailReason"
      FROM "Membership"
      WHERE "locationId" = $1
        AND "deletedAt" IS NULL
        AND "billingStatus" IN ('retry_scheduled', 'past_due')
        AND "failedAttempts" >= 3
        AND "lastFailedAt" IS NOT NULL
        AND "lastFailedAt" + make_interval(days => $2) <= NOW()
    `, locationId, gracePeriodDays)

  if (candidates.length === 0) {
    return { expired: 0 }
  }

  let expired = 0

  for (const mbr of candidates) {
    // Transition: status → expired, billingStatus → uncollectible
    await db.$executeRawUnsafe(`
      UPDATE "Membership"
      SET "status" = 'expired',
          "billingStatus" = 'uncollectible',
          "endedAt" = NOW(),
          "statusReason" = 'Dunning exhausted after ' || $2 || ' failed attempts',
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "id" = $1
        AND "status" IN ('active', 'trial')
    `, mbr.id, mbr.failedAttempts)

    // Append-only audit event
    await db.$executeRawUnsafe(`
      INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details")
      VALUES ($1, $2, $3, $4)
    `,
      mbr.locationId,
      mbr.id,
      MembershipEventType.EXPIRED,
      JSON.stringify({
        reason: 'dunning_exhausted',
        failedAttempts: mbr.failedAttempts,
        lastFailReason: mbr.lastFailReason,
        gracePeriodDays,
      })
    )

    expired++
  }

  return { expired }
}
