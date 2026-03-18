/**
 * Membership billing processor — charges due memberships via Datacap PayAPI.
 * Called by the /api/cron/membership-billing cron route.
 *
 * Flow:
 *   1. Acquire leases (billing lock) on due memberships
 *   2. Convert expired trials → active
 *   3. Check idempotency (skip already-charged periods)
 *   4. Charge via PayAPI with recurring data chain
 *   5. Atomically write charge + update membership + emit event
 *   6. Release leases
 */
import { getPayApiClient, PayApiError } from '@/lib/datacap/payapi-client'
import type { PayApiResponse } from '@/lib/datacap/payapi-client'
import { parseSettings, DEFAULT_MEMBERSHIP_SETTINGS } from '@/lib/settings'
import type { MembershipSettings } from '@/lib/settings'
import { createChildLogger } from '@/lib/logger'
import { classifyDecline } from './decline-rules'
import { buildIdempotencyKey } from './idempotency'
import {
  ChargeType,
  ChargeStatus,
  MembershipStatus,
  BillingStatus,
  MembershipEventType,
  type DeclineClassification,
} from './types'

const log = createChildLogger('membership')

// ─── Types ──────────────────────────────────────────────────────────────────

interface BillingResult {
  processed: number
  succeeded: number
  failed: number
  timedOut: number
}

interface ClaimedMembership {
  id: string
  locationId: string
  customerId: string
  planId: string
  savedCardId: string | null
  status: string
  billingStatus: string
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  nextBillingDate: Date | null
  trialEndsAt: Date | null
  priceAtSignup: string // Decimal comes as string from raw SQL
  billingCycle: string | null
  currency: string
  recurringData: string | null
  lastToken: string | null
  version: number
  failedAttempts: number
  lastChargeId: string | null
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function processMembershipBilling(
  locationId: string,
  db: any
): Promise<BillingResult> {
  const result: BillingResult = { processed: 0, succeeded: 0, failed: 0, timedOut: 0 }
  const lockId = `lock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Load location settings for tax rate + membership config
  const locRows: any[] = await db.$queryRawUnsafe(
    `SELECT "settings" FROM "Location" WHERE "id" = $1 LIMIT 1`,
    locationId
  )
  const settings = locRows.length > 0 ? parseSettings(locRows[0].settings) : parseSettings(null)
  const taxRate = settings.tax.defaultRate ?? 0
  const mbrSettings: MembershipSettings = settings.memberships ?? DEFAULT_MEMBERSHIP_SETTINGS
  const retrySchedule = mbrSettings.retryScheduleDays ?? [0, 3, 7]

  // ── Step 1: Acquire leases ──────────────────────────────────────────────
  await db.$executeRawUnsafe(`
    UPDATE "Membership"
    SET "billingLockedAt" = NOW(),
        "billingLockId" = $1,
        "billingLockExpiresAt" = NOW() + interval '5 minutes'
    WHERE "locationId" = $2
      AND "deletedAt" IS NULL
      AND ("nextBillingDate" <= NOW() OR "nextRetryAt" <= NOW())
      AND "status" IN ('trial', 'active')
      AND "billingStatus" != 'uncollectible'
      AND ("billingLockExpiresAt" IS NULL OR "billingLockExpiresAt" < NOW())
    LIMIT 50
  `, lockId, locationId)

  // ── Step 2: Fetch claimed rows ──────────────────────────────────────────
  const claimed: ClaimedMembership[] = await db.$queryRawUnsafe(`
    SELECT "id", "locationId", "customerId", "planId", "savedCardId",
           "status", "billingStatus",
           "currentPeriodStart", "currentPeriodEnd", "nextBillingDate",
           "trialEndsAt", "priceAtSignup", "billingCycle", "currency",
           "recurringData", "lastToken", "version", "failedAttempts", "lastChargeId"
    FROM "Membership"
    WHERE "billingLockId" = $1 AND "locationId" = $2
  `, lockId, locationId)

  if (claimed.length === 0) return result

  const payapi = getPayApiClient()

  // ── Step 3: Process each membership ─────────────────────────────────────
  for (const mbr of claimed) {
    try {
      await processOneMembership(mbr, payapi, db, taxRate, retrySchedule)
      result.succeeded++
    } catch (err) {
      if (err instanceof PayApiError && err.status === 408) {
        result.timedOut++
      } else {
        result.failed++
        log.error({ err: err }, `[membership-billing] Error processing ${mbr.id}:`)
      }
    }
    result.processed++
  }

  // ── Step 4: Release all leases ──────────────────────────────────────────
  await db.$executeRawUnsafe(`
    UPDATE "Membership"
    SET "billingLockedAt" = NULL,
        "billingLockId" = NULL,
        "billingLockExpiresAt" = NULL
    WHERE "billingLockId" = $1 AND "locationId" = $2
  `, lockId, locationId)

  return result
}

// ─── Process Single Membership ──────────────────────────────────────────────

async function processOneMembership(
  mbr: ClaimedMembership,
  payapi: ReturnType<typeof getPayApiClient>,
  db: any,
  taxRate: number,
  retrySchedule: number[]
): Promise<void> {
  // Convert expired trial → active
  if (mbr.status === MembershipStatus.TRIAL && mbr.trialEndsAt && new Date(mbr.trialEndsAt) <= new Date()) {
    await db.$executeRawUnsafe(`
      UPDATE "Membership"
      SET "status" = 'active', "startedAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = $1
    `, mbr.id)
    mbr.status = MembershipStatus.ACTIVE
  }

  // Determine charge type
  const isRetry = mbr.billingStatus === BillingStatus.RETRY_SCHEDULED || mbr.billingStatus === BillingStatus.PAST_DUE
  const chargeType = isRetry ? ChargeType.RETRY : ChargeType.RENEWAL

  // Build idempotency key
  const idempotencyKey = chargeType === ChargeType.RETRY
    ? buildIdempotencyKey({
        type: ChargeType.RETRY,
        params: { membershipId: mbr.id, chargeId: mbr.lastChargeId || mbr.id, attempt: mbr.failedAttempts + 1 },
      })
    : buildIdempotencyKey({
        type: ChargeType.RENEWAL,
        params: { membershipId: mbr.id, periodStart: mbr.currentPeriodEnd || new Date() },
      })

  // Check idempotency — skip if already approved for this key
  const existing: any[] = await db.$queryRawUnsafe(`
    SELECT "id" FROM "MembershipCharge"
    WHERE "idempotencyKey" = $1 AND "status" = 'approved'
    LIMIT 1
  `, idempotencyKey)

  if (existing.length > 0) return // Already charged this period

  // Validate token
  if (!mbr.lastToken) {
    // No card on file — mark uncollectible
    await db.$executeRawUnsafe(`
      UPDATE "Membership"
      SET "billingStatus" = 'uncollectible',
          "lastFailReason" = 'No card on file',
          "updatedAt" = NOW(),
          "version" = "version" + 1
      WHERE "id" = $1
    `, mbr.id)
    await insertEvent(db, mbr, MembershipEventType.CHARGE_FAILED, { reason: 'No card on file' })
    return
  }

  // Calculate amounts
  const subtotal = parseFloat(mbr.priceAtSignup || '0')
  // Membership billing uses exclusive tax only — not affected by tax-inclusive pricing
  const tax = Math.round(subtotal * taxRate) / 100 // taxRate is a percentage (e.g. 8.25)
  const total = Math.round((subtotal + tax) * 100) / 100
  const invoiceNo = `MBR-${mbr.id.slice(-6)}-${Date.now()}`

  // ── Charge via PayAPI ─────────────────────────────────────────────────
  const requestStartedAt = new Date()
  let response: PayApiResponse | null = null
  let chargeStatus: ChargeStatus = ChargeStatus.PENDING
  let failureType: string | null = null
  let decline: DeclineClassification | null = null

  try {
    response = await payapi.sale({
      token: mbr.lastToken,
      amount: total.toFixed(2),
      invoiceNo,
      tax: tax.toFixed(2),
      recurringData: mbr.recurringData || 'Recurring',
    })
    chargeStatus = ChargeStatus.APPROVED
  } catch (err) {
    if (err instanceof PayApiError) {
      if (err.status === 408) {
        // Timeout — leave as pending, do NOT increment failure counter
        chargeStatus = ChargeStatus.PENDING
        failureType = 'timeout'
        response = err.response ?? null
      } else {
        chargeStatus = ChargeStatus.DECLINED
        response = err.response ?? null
        decline = classifyDecline(response?.returnCode, response?.message)
        failureType = decline.category === 'hard_decline' ? 'decline'
          : decline.category === 'processor_error' ? 'processor_error'
          : decline.category === 'config_error' ? 'config_error'
          : 'decline'
      }
    } else {
      throw err // Unexpected error, let outer catch handle
    }
  }

  const responseReceivedAt = new Date()
  const newRecurringData = response?.recurringData || mbr.recurringData

  // ── Compute next billing date ───────────────────────────────────────────
  const periodStart = mbr.currentPeriodEnd || new Date()
  const periodEnd = advancePeriod(periodStart, mbr.billingCycle || 'monthly')

  // ── Atomic write ──────────────────────────────────────────────────────
  if (chargeStatus === ChargeStatus.APPROVED) {
    // SUCCESS PATH
    await db.$executeRawUnsafe(`
      INSERT INTO "MembershipCharge" (
        "locationId", "membershipId", "subtotalAmount", "taxAmount", "totalAmount",
        "status", "chargeType", "attemptNumber", "retryNumber",
        "periodStart", "periodEnd",
        "datacapRefNo", "datacapAuthCode", "datacapToken",
        "recurringDataSent", "recurringDataReceived",
        "invoiceNo", "idempotencyKey",
        "requestStartedAt", "responseReceivedAt", "processedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        'approved', $6, $7, $8,
        $9, $10,
        $11, $12, $13,
        $14, $15,
        $16, $17,
        $18, $19, NOW()
      )
    `,
      mbr.locationId, mbr.id, subtotal, tax, total,
      chargeType, mbr.failedAttempts + 1, isRetry ? mbr.failedAttempts : 0,
      periodStart, periodEnd,
      response?.refNo || null, response?.authCode || null, response?.token || null,
      mbr.recurringData || 'Recurring', newRecurringData || null,
      invoiceNo, idempotencyKey,
      requestStartedAt, responseReceivedAt
    )

    await db.$executeRawUnsafe(`
      UPDATE "Membership"
      SET "currentPeriodStart" = $2,
          "currentPeriodEnd" = $3,
          "nextBillingDate" = $3,
          "lastChargedAt" = NOW(),
          "failedAttempts" = 0,
          "lastFailedAt" = NULL,
          "lastFailReason" = NULL,
          "nextRetryAt" = NULL,
          "billingStatus" = 'current',
          "recurringData" = $4,
          "lastToken" = COALESCE($5, "lastToken"),
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "id" = $1
    `, mbr.id, periodStart, periodEnd, newRecurringData, response?.token || null)

    await insertEvent(db, mbr, MembershipEventType.CHARGE_SUCCESS, {
      chargeType,
      total,
      refNo: response?.refNo,
    })
  } else if (chargeStatus === ChargeStatus.PENDING && failureType === 'timeout') {
    // TIMEOUT PATH — record charge as pending, do NOT touch billing status
    await db.$executeRawUnsafe(`
      INSERT INTO "MembershipCharge" (
        "locationId", "membershipId", "subtotalAmount", "taxAmount", "totalAmount",
        "status", "chargeType", "failureType", "attemptNumber",
        "periodStart", "periodEnd",
        "recurringDataSent", "invoiceNo", "idempotencyKey",
        "requestStartedAt", "responseReceivedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        'pending', $6, 'timeout', $7,
        $8, $9,
        $10, $11, $12,
        $13, $14
      )
    `,
      mbr.locationId, mbr.id, subtotal, tax, total,
      chargeType, mbr.failedAttempts + 1,
      periodStart, periodEnd,
      mbr.recurringData || 'Recurring', invoiceNo, idempotencyKey,
      requestStartedAt, responseReceivedAt
    )

    // Always advance recurring data chain even on timeout
    if (newRecurringData && newRecurringData !== mbr.recurringData) {
      await db.$executeRawUnsafe(`
        UPDATE "Membership" SET "recurringData" = $2, "updatedAt" = NOW() WHERE "id" = $1
      `, mbr.id, newRecurringData)
    }

    throw new PayApiError('Timeout', 408)
  } else {
    // DECLINE PATH
    const newFailedAttempts = mbr.failedAttempts + 1
    const isHardDecline = decline?.category === 'hard_decline'
    const maxRetries = retrySchedule.length

    let newBillingStatus: string
    let nextRetryAt: Date | null = null

    if (isHardDecline) {
      newBillingStatus = BillingStatus.UNCOLLECTIBLE
    } else if (newFailedAttempts >= maxRetries) {
      newBillingStatus = BillingStatus.PAST_DUE
    } else {
      newBillingStatus = BillingStatus.RETRY_SCHEDULED
      const retryDays = retrySchedule[newFailedAttempts] ?? retrySchedule[retrySchedule.length - 1] ?? 7
      nextRetryAt = new Date()
      nextRetryAt.setDate(nextRetryAt.getDate() + retryDays)
    }

    await db.$executeRawUnsafe(`
      INSERT INTO "MembershipCharge" (
        "locationId", "membershipId", "subtotalAmount", "taxAmount", "totalAmount",
        "status", "chargeType", "failureType", "attemptNumber", "retryNumber",
        "periodStart", "periodEnd",
        "datacapRefNo", "datacapToken",
        "recurringDataSent", "recurringDataReceived",
        "invoiceNo", "idempotencyKey",
        "declineReason", "returnCode", "processorResponseMessage",
        "requestStartedAt", "responseReceivedAt", "processedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        'declined', $6, $7, $8, $9,
        $10, $11,
        $12, $13,
        $14, $15,
        $16, $17,
        $18, $19, $20,
        $21, $22, NOW()
      )
    `,
      mbr.locationId, mbr.id, subtotal, tax, total,
      chargeType, failureType, newFailedAttempts, isRetry ? newFailedAttempts - 1 : 0,
      periodStart, periodEnd,
      response?.refNo || null, response?.token || null,
      mbr.recurringData || 'Recurring', newRecurringData || null,
      invoiceNo, idempotencyKey,
      decline?.message || response?.message || null, response?.returnCode || null, response?.message || null,
      requestStartedAt, responseReceivedAt
    )

    await db.$executeRawUnsafe(`
      UPDATE "Membership"
      SET "billingStatus" = $2,
          "failedAttempts" = $3,
          "lastFailedAt" = NOW(),
          "lastFailReason" = $4,
          "nextRetryAt" = $5,
          "recurringData" = $6,
          "lastToken" = COALESCE($7, "lastToken"),
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "id" = $1
    `,
      mbr.id, newBillingStatus, newFailedAttempts,
      decline?.message || response?.message || 'Unknown decline',
      nextRetryAt, newRecurringData,
      response?.token || null
    )

    await insertEvent(db, mbr, MembershipEventType.CHARGE_FAILED, {
      chargeType,
      failureType,
      category: decline?.category || 'unknown',
      message: decline?.message || response?.message,
      returnCode: response?.returnCode,
      billingStatus: newBillingStatus,
    })
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function advancePeriod(from: Date, billingCycle: string): Date {
  const d = new Date(from)
  switch (billingCycle) {
    case 'weekly':
      d.setDate(d.getDate() + 7)
      break
    case 'annual':
      d.setFullYear(d.getFullYear() + 1)
      break
    case 'monthly':
    default:
      d.setMonth(d.getMonth() + 1)
      break
  }
  return d
}

async function insertEvent(
  db: any,
  mbr: { id: string; locationId: string },
  eventType: MembershipEventType,
  details: Record<string, unknown>
): Promise<void> {
  await db.$executeRawUnsafe(`
    INSERT INTO "MembershipEvent" ("locationId", "membershipId", "eventType", "details")
    VALUES ($1, $2, $3, $4)
  `, mbr.locationId, mbr.id, eventType, JSON.stringify(details))
}
