/**
 * Cron: Token Refresh via Datacap Account Updater
 *
 * Enrolls active membership tokens + saved cards into Datacap's Account Updater
 * service. Once enrolled, Datacap returns a PID (Payment Account ID) that
 * auto-refreshes card data twice monthly. The PID replaces the raw DC4 token
 * for all future charges.
 *
 * Flow:
 *   1. Find memberships + saved cards WITHOUT an accountUpdaterPid
 *   2. Call POST /V1/AccountUpdate/Create with the existing token
 *   3. Store the returned PID on the record
 *   4. Future charges use the PID (which always has current card data)
 *
 * For already-enrolled PIDs, no action needed — Datacap updates them automatically.
 * If a PID needs to be re-enrolled (e.g., after a hard decline), clear the PID
 * column and this cron will re-enroll on next run.
 *
 * Schedule: Weekly (Vercel cron or external scheduler)
 * Supports: Visa, Amex, Mastercard, Discover (NOT Interac)
 */
import { NextRequest } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { getPayApiClient, PayApiError } from '@/lib/datacap/payapi-client'
import { MembershipEventType } from '@/lib/membership/types'
import { ok } from '@/lib/api-response'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('token-refresh')

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface TokenRefreshResult {
  membershipsEnrolled: number
  membershipsFailed: number
  membershipsSkipped: number
  savedCardsEnrolled: number
  savedCardsFailed: number
  savedCardsSkipped: number
}

export async function GET(request: NextRequest) {
  const cronAuthError = verifyCronSecret(request.headers.get('authorization'))
  if (cronAuthError) return cronAuthError

  const allResults: Array<{ slug: string; result: TokenRefreshResult }> = []

  const summary = await forAllVenues(async (venueDb, slug) => {
    const result = await refreshTokensForVenue(venueDb)
    allResults.push({ slug, result })
  }, { label: 'cron:token-refresh', concurrency: 3 })

  return ok({ ...summary, results: allResults })
}

async function refreshTokensForVenue(db: any): Promise<TokenRefreshResult> {
  const result: TokenRefreshResult = {
    membershipsEnrolled: 0,
    membershipsFailed: 0,
    membershipsSkipped: 0,
    savedCardsEnrolled: 0,
    savedCardsFailed: 0,
    savedCardsSkipped: 0,
  }

  const payapi = getPayApiClient()

  // ── 1. Enroll membership tokens that don't have a PID yet ─────────────
  // Only active/trial memberships with a lastToken and no PID
  const memberships: Array<{
    id: string
    locationId: string
    lastToken: string
    accountUpdaterPid: string | null
  }> = await db.$queryRaw`
    SELECT "id", "locationId", "lastToken", "accountUpdaterPid"
    FROM "Membership"
    WHERE "deletedAt" IS NULL
      AND "status" IN ('active', 'trial')
      AND "lastToken" IS NOT NULL
      AND "accountUpdaterPid" IS NULL
    LIMIT 100
  `

  for (const mbr of memberships) {
    // Skip tokens that are already PIDs (re-enrolled shouldn't happen but guard)
    if (mbr.lastToken.startsWith('PID:')) {
      result.membershipsSkipped++
      continue
    }

    try {
      const response = await payapi.accountUpdaterCreate(mbr.lastToken)

      // The returned Token field contains the PID (e.g., "PID:132135")
      const pid = response.token
      if (!pid || !pid.startsWith('PID:')) {
        log.warn({ membershipId: mbr.id, token: '***' }, 'Account Updater returned non-PID token — skipping')
        result.membershipsFailed++
        continue
      }

      // Store the PID. Future charges should use this PID instead of lastToken.
      // We also update lastToken to the PID so the billing processor uses it automatically.
      await db.$executeRaw`
        UPDATE "Membership"
        SET "accountUpdaterPid" = ${pid},
            "lastToken" = ${pid},
            "updatedAt" = NOW(),
            "version" = "version" + 1
        WHERE "id" = ${mbr.id}
      `

      // Audit event
      await db.$executeRaw`
        INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details")
        VALUES (${mbr.locationId}, ${mbr.id}, ${MembershipEventType.TOKEN_ENROLLED_UPDATER}, ${JSON.stringify({ pid, previousTokenPrefix: mbr.lastToken.slice(0, 4) })})
      `

      result.membershipsEnrolled++
      log.info({ membershipId: mbr.id }, 'Enrolled membership token in Account Updater')
    } catch (err) {
      result.membershipsFailed++
      const message = err instanceof PayApiError ? err.message : (err instanceof Error ? err.message : String(err))
      log.error({ membershipId: mbr.id, err: message }, 'Failed to enroll membership in Account Updater')

      // Record the failure as an event for visibility
      await db.$executeRaw`
        INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details")
        VALUES (${mbr.locationId}, ${mbr.id}, ${MembershipEventType.TOKEN_REFRESH_FAILED}, ${JSON.stringify({ error: message })})
      `.catch(() => { /* best effort */ })
    }
  }

  // ── 2. Enroll saved card tokens that don't have a PID yet ─────────────
  // Saved cards (card-on-file) that are not yet enrolled in Account Updater
  const savedCards: Array<{
    id: string
    locationId: string
    token: string
    accountUpdaterPid: string | null
  }> = await db.$queryRaw`
    SELECT "id", "locationId", "token", "accountUpdaterPid"
    FROM "SavedCard"
    WHERE "deletedAt" IS NULL
      AND "token" IS NOT NULL
      AND "accountUpdaterPid" IS NULL
    LIMIT 100
  `

  for (const card of savedCards) {
    // Skip tokens that are already PIDs
    if (card.token.startsWith('PID:')) {
      result.savedCardsSkipped++
      continue
    }

    try {
      const response = await payapi.accountUpdaterCreate(card.token)
      const pid = response.token

      if (!pid || !pid.startsWith('PID:')) {
        log.warn({ savedCardId: card.id }, 'Account Updater returned non-PID token for saved card — skipping')
        result.savedCardsFailed++
        continue
      }

      // Store the PID and update the token so future charges use the PID
      await db.$executeRaw`
        UPDATE "SavedCard"
        SET "accountUpdaterPid" = ${pid},
            "token" = ${pid},
            "updatedAt" = NOW()
        WHERE "id" = ${card.id}
      `

      result.savedCardsEnrolled++
      log.info({ savedCardId: card.id }, 'Enrolled saved card in Account Updater')
    } catch (err) {
      result.savedCardsFailed++
      const message = err instanceof PayApiError ? err.message : (err instanceof Error ? err.message : String(err))
      log.error({ savedCardId: card.id, err: message }, 'Failed to enroll saved card in Account Updater')
    }
  }

  return result
}
