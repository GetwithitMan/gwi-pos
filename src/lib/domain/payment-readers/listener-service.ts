/**
 * Payment Reader Listener Service — Domain logic for passive card detection.
 *
 * Manages reader leases (fencing tokens), card polling, duplicate suppression,
 * open-tab lookup, and detection resolution. All DB operations use server time
 * (NOW()) as authoritative. recordNo never leaves the server boundary.
 *
 * Error taxonomy: recoverable_timeout, reader_busy, reader_offline,
 * transport_error, stale_lease, lease_conflict, invalid_card_payload,
 * detection_expired, order_version_conflict, suppressed_duplicate,
 * pad_reset_failed, unauthorized, provider_error_unknown
 */

import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'
import { normalizeCardholderName } from '@/lib/datacap/helpers'
import { DatacapReaderAdapter } from './reader-adapter'
import type { PaymentReaderAdapter, CardReadResult } from './reader-adapter'
import { randomUUID } from 'crypto'

const log = createChildLogger('card-listener')

// ─── Error Types ────────────────────────────────────────────────────────────

export class ListenerError extends Error {
  public readonly code: string
  public readonly httpStatus: number

  constructor(code: string, message: string, httpStatus = 400) {
    super(message)
    this.name = 'ListenerError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LeaseResult {
  sessionId: string
  leaseVersion: number
  leasedUntil: Date
}

export interface PollResult {
  type: 'card_detected' | 'timeout' | 'suppressed'
  detectionId?: string
  sessionId?: string
  leaseVersion?: number
  card?: {
    brand: string | null
    last4: string | null
    holderName: string | null
    entryMethod: string | null
    walletType: string | null
  }
  match?: TabMatchResult
}

export interface TabMatchResult {
  kind: 'open_tab_found' | 'no_open_tab' | 'ambiguous'
  orderId?: string
  orderNumber?: number
  tabName?: string
  amount?: number
  tabs?: Array<{ orderId: string; orderNumber: number; tabName: string | null; amount: number }>
}

export interface ResolveDetectionResult {
  recordNo: string
  cardType: string | null
  cardLast4: string | null
  cardholderName: string | null
  entryMethod: string | null
  walletType: string | null
  matchKind: string
  matchedOrderId: string | null
}

// ─── Constants ──────────────────────────────────────────────────────────────

const LEASE_TTL_MS = 30_000 // 30s
const SUPPRESSION_WINDOW_MS = 15_000 // 15s
const DETECTION_EXPIRY_MS = 5 * 60_000 // 5 min
const POLL_ITERATION_TIMEOUT_MS = 10_000 // 10s per CollectCardData call
const DEFAULT_POLL_TIMEOUT_S = 300 // 5 min total

// ─── Lease Management ───────────────────────────────────────────────────────

/**
 * Acquire exclusive lease on a reader for passive card detection.
 * Uses atomic UPDATE with fencing token (leaseVersion increment).
 */
export async function acquireLease(
  readerId: string,
  terminalId: string,
): Promise<LeaseResult> {
  const sessionId = randomUUID()

  // Atomic: acquire only if lease expired or same terminal re-acquiring
  const rows = await db.$queryRawUnsafe<any[]>(
    `UPDATE "PaymentReader"
     SET "leaseVersion" = "leaseVersion" + 1,
         "leaseTerminalId" = $1,
         "leaseSessionId" = $2,
         "leasedUntil" = NOW() + INTERVAL '30 seconds',
         "lastHeartbeatAt" = NOW(),
         "readerState" = 'listening'
     WHERE id = $3
       AND ("leasedUntil" IS NULL OR "leasedUntil" < NOW() OR "leaseTerminalId" = $1)
     RETURNING "leaseVersion", "leasedUntil"`,
    terminalId,
    sessionId,
    readerId,
  )

  if (rows.length === 0) {
    // Lease held by another terminal — fetch who has it for the error
    const current = await db.paymentReader.findUnique({
      where: { id: readerId },
      select: { leaseTerminalId: true },
    })
    throw new ListenerError(
      'lease_conflict',
      `Reader leased to terminal ${current?.leaseTerminalId ?? 'unknown'}`,
      409,
    )
  }

  const row = rows[0]
  return {
    sessionId,
    leaseVersion: row.leaseVersion,
    leasedUntil: new Date(row.leasedUntil),
  }
}

/**
 * Heartbeat renewal — extends lease TTL.
 * Validates session + fencing token before renewing.
 */
export async function renewLease(
  readerId: string,
  sessionId: string,
  leaseVersion: number,
): Promise<Date> {
  const rows = await db.$queryRawUnsafe<any[]>(
    `UPDATE "PaymentReader"
     SET "leasedUntil" = NOW() + INTERVAL '30 seconds',
         "lastHeartbeatAt" = NOW()
     WHERE id = $1
       AND "leaseSessionId" = $2
       AND "leaseVersion" = $3
     RETURNING "leasedUntil"`,
    readerId,
    sessionId,
    leaseVersion,
  )

  if (rows.length === 0) {
    throw new ListenerError(
      'stale_lease',
      'Lease expired or taken by another terminal',
      409,
    )
  }

  return new Date(rows[0].leasedUntil)
}

/**
 * Release reader lease with audit reason.
 * Clears lease fields and sets reader back to idle.
 */
export async function releaseLease(
  readerId: string,
  sessionId: string,
  reason: string,
): Promise<void> {
  const rows = await db.$queryRawUnsafe<any[]>(
    `UPDATE "PaymentReader"
     SET "leaseTerminalId" = NULL,
         "leaseSessionId" = NULL,
         "leasedUntil" = NULL,
         "lastHeartbeatAt" = NULL,
         "readerState" = 'idle'
     WHERE id = $1 AND "leaseSessionId" = $2
     RETURNING id`,
    readerId,
    sessionId,
  )

  if (rows.length === 0) {
    log.warn({ readerId, sessionId, reason }, 'Release ignored — session mismatch')
    return
  }

  log.info({ readerId, sessionId, reason }, 'Lease released')
}

// ─── Card Polling ───────────────────────────────────────────────────────────

/**
 * Main polling loop — validates lease, calls reader, handles suppression.
 *
 * On card read: checks suppression → finds open tabs → creates CardDetection row.
 * On timeout: retries up to timeoutSeconds total.
 * On error: classifies and either retries (recoverable) or fails.
 *
 * Returns card data + match info. recordNo stays server-side (in CardDetection).
 */
export async function pollForCard(
  readerId: string,
  locationId: string,
  terminalId: string,
  sessionId: string,
  leaseVersion: number,
  timeoutSeconds: number = DEFAULT_POLL_TIMEOUT_S,
  adapter?: PaymentReaderAdapter,
): Promise<PollResult> {
  const readerAdapter = adapter ?? new DatacapReaderAdapter(locationId)
  const deadline = Date.now() + timeoutSeconds * 1000
  let consecutiveErrors = 0

  while (Date.now() < deadline) {
    // 1. Validate lease is still current (fencing check)
    await validateLeaseForPoll(readerId, sessionId, leaseVersion)

    // 2. Attempt card read with per-iteration timeout
    let cardResult: CardReadResult
    try {
      cardResult = await withTimeout(
        readerAdapter.collectCardData(readerId, { placeholderAmount: 0.01 }),
        POLL_ITERATION_TIMEOUT_MS,
      )
      consecutiveErrors = 0 // reset on any response
    } catch (err) {
      const classified = classifyReaderError(err)

      if (classified === 'recoverable_timeout') {
        // Timeout is normal — reader waiting for card tap. Retry.
        continue
      }

      consecutiveErrors++

      // Circuit breaker: 3 consecutive failures → error_backoff
      if (consecutiveErrors >= 3) {
        await setReaderState(readerId, sessionId, 'error_backoff')
        throw new ListenerError(classified, `Reader error after ${consecutiveErrors} retries`)
      }

      // Backoff on retryable errors
      if (classified === 'transport_error' || classified === 'reader_busy') {
        const backoffMs = Math.min(2000 * Math.pow(2, consecutiveErrors - 1), 30_000)
        await sleep(backoffMs)
        continue
      }

      // Non-retryable: reader_offline, etc.
      throw new ListenerError(classified, errorMessage(err))
    }

    // 3. Handle failed card read
    if (!cardResult.success) {
      const code = classifyCardReadError(cardResult.error)
      if (code === 'recoverable_timeout') continue
      throw new ListenerError(code, cardResult.error || 'Card read failed')
    }

    // 4. Validate card payload
    if (!cardResult.recordNo) {
      throw new ListenerError(
        'invalid_card_payload',
        'Card read returned no recordNo',
      )
    }

    // 5. Check suppression (duplicate read within 15s window)
    const fingerprint = cardResult.recordNo
    const suppressed = await checkAndUpdateSuppression(readerId, fingerprint)

    if (suppressed) {
      // Create minimized CardDetection row for audit
      await createSuppressionRecord({
        readerId,
        terminalId,
        sessionId,
        locationId,
        leaseVersion,
        fingerprint,
        reason: 'duplicate_window',
      })
      return { type: 'suppressed' }
    }

    // 6. Find open tabs by recordNo
    const match = await findOpenTabsByFingerprint(locationId, cardResult.recordNo)

    // 7. Create CardDetection row (atomic with suppression update)
    const detectionId = randomUUID()
    const normalizedName = normalizeCardholderName(cardResult.cardholderName) || null

    await db.$transaction(async (tx) => {
      // Re-validate lease inside tx (fencing)
      const leaseCheck = await tx.$queryRawUnsafe<any[]>(
        `SELECT "leaseVersion" FROM "PaymentReader"
         WHERE id = $1 AND "leaseSessionId" = $2 AND "leaseVersion" = $3
         FOR UPDATE`,
        readerId,
        sessionId,
        leaseVersion,
      )
      if (leaseCheck.length === 0) {
        throw new ListenerError('stale_lease', 'Lease lost during detection write', 409)
      }

      // Update suppression fingerprint on reader
      await tx.$executeRawUnsafe(
        `UPDATE "PaymentReader"
         SET "lastDetectionFingerprint" = $1, "lastDetectionAt" = NOW()
         WHERE id = $2`,
        fingerprint,
        readerId,
      )

      // Write CardDetection
      await tx.cardDetection.create({
        data: {
          detectionId,
          readerId,
          terminalId,
          sessionId,
          locationId,
          recordNo: cardResult.recordNo,
          cardType: cardResult.cardType,
          cardLast4: cardResult.cardLast4,
          cardholderName: normalizedName,
          entryMethod: cardResult.entryMethod,
          walletType: cardResult.walletType,
          matchKind: match.kind,
          matchedOrderId: match.orderId ?? null,
          leaseVersion,
          status: 'pending',
          decisionExpiresAt: new Date(Date.now() + DETECTION_EXPIRY_MS),
        },
      })
    })

    // 8. Return card data + match info (no recordNo!)
    return {
      type: 'card_detected',
      detectionId,
      sessionId,
      leaseVersion,
      card: {
        brand: cardResult.cardType,
        last4: cardResult.cardLast4,
        holderName: normalizedName,
        entryMethod: cardResult.entryMethod,
        walletType: cardResult.walletType,
      },
      match,
    }
  }

  // Total timeout reached
  return { type: 'timeout' }
}

// ─── Detection Resolution ───────────────────────────────────────────────────

/**
 * Resolve a pending CardDetection — validates auth/expiry/status, returns full
 * card data (including recordNo) for the caller to use in tab/card operations.
 *
 * recordNo is returned to server-side callers only (route handlers), never to clients.
 */
export async function resolveDetection(
  detectionId: string,
  locationId: string,
  actionTaken: string,
  actionResult: string,
  resolvedByUserId: string | null,
  resolvedByTerminalId: string,
  expectedOrderVersion?: number,
): Promise<ResolveDetectionResult> {
  return await db.$transaction(async (tx) => {
    // Lock the detection row
    const rows = await tx.$queryRawUnsafe<any[]>(
      `SELECT * FROM "CardDetection"
       WHERE "detectionId" = $1
       FOR UPDATE`,
      detectionId,
    )

    if (rows.length === 0) {
      throw new ListenerError('unauthorized', 'Detection not found', 404)
    }

    const detection = rows[0]

    // Validate location ownership
    if (detection.locationId !== locationId) {
      throw new ListenerError('unauthorized', 'Detection does not belong to this location', 403)
    }

    // Check expiry (server time authoritative)
    const nowCheck = await tx.$queryRawUnsafe<any[]>(`SELECT NOW() AS now`)
    const now = new Date(nowCheck[0].now)
    if (new Date(detection.decisionExpiresAt) < now) {
      // Mark expired if still pending
      if (detection.status === 'pending') {
        await tx.$executeRawUnsafe(
          `UPDATE "CardDetection" SET status = 'expired' WHERE "detectionId" = $1`,
          detectionId,
        )
      }
      throw new ListenerError('detection_expired', 'Detection has expired', 409)
    }

    // Status must be pending
    if (detection.status !== 'pending') {
      // Idempotency: same detection + same action → return original result
      if (detection.status === 'resolved' && detection.actionTaken === actionTaken) {
        return extractDetectionResult(detection)
      }
      // Different action on same detection → conflict
      if (detection.status === 'resolved') {
        throw new ListenerError(
          'detection_expired',
          `Detection already resolved with action: ${detection.actionTaken}`,
          409,
        )
      }
      throw new ListenerError('detection_expired', `Detection status is ${detection.status}`, 409)
    }

    // Suppressed detections are terminal
    if (detection.status === 'suppressed') {
      throw new ListenerError('detection_expired', 'Suppressed detections cannot be resolved', 409)
    }

    // Check order version if provided (optimistic concurrency)
    if (expectedOrderVersion != null && detection.matchedOrderId) {
      const order = await tx.$queryRawUnsafe<any[]>(
        `SELECT version FROM "Order" WHERE id = $1 FOR UPDATE`,
        detection.matchedOrderId,
      )
      if (order.length > 0 && order[0].version !== expectedOrderVersion) {
        throw new ListenerError(
          'order_version_conflict',
          'Order has been modified since detection',
          409,
        )
      }
    }

    // Atomically resolve
    await tx.$executeRawUnsafe(
      `UPDATE "CardDetection"
       SET status = 'resolved',
           "actionTaken" = $2,
           "actionResult" = $3,
           "resolvedAt" = NOW(),
           "resolvedByUserId" = $4,
           "resolvedByTerminalId" = $5
       WHERE "detectionId" = $1`,
      detectionId,
      actionTaken,
      actionResult,
      resolvedByUserId,
      resolvedByTerminalId,
    )

    return extractDetectionResult(detection)
  })
}

// ─── Open Tab Lookup ────────────────────────────────────────────────────────

/**
 * Find open tabs matching a recordNo (Datacap vault token).
 * Queries OrderCard + Order for open bar_tab orders at this location.
 * Returns ranked results: most recent activity first.
 */
export async function findOpenTabsByFingerprint(
  locationId: string,
  recordNo: string,
): Promise<TabMatchResult> {
  const tabs = await db.$queryRawUnsafe<any[]>(
    `SELECT o.id AS "orderId", o."orderNumber", o."tabName",
            COALESCE(o."preAuthAmount", 0) + COALESCE(
              (SELECT SUM(oi."pricePerUnit" * oi.quantity) FROM "OrderItem" oi WHERE oi."orderId" = o.id AND oi."deletedAt" IS NULL),
              0
            ) AS amount,
            o."updatedAt"
     FROM "OrderCard" oc
     JOIN "Order" o ON o.id = oc."orderId"
     WHERE oc."recordNo" = $1
       AND oc."deletedAt" IS NULL
       AND o.status = 'open'
       AND o."orderType" = 'bar_tab'
       AND o."locationId" = $2
     ORDER BY o."updatedAt" DESC
     LIMIT 10`,
    recordNo,
    locationId,
  )

  if (tabs.length === 0) {
    return { kind: 'no_open_tab' }
  }

  if (tabs.length === 1) {
    const tab = tabs[0]
    return {
      kind: 'open_tab_found',
      orderId: tab.orderId,
      orderNumber: tab.orderNumber,
      tabName: tab.tabName,
      amount: Number(tab.amount),
    }
  }

  // Multiple matches — ambiguous
  return {
    kind: 'ambiguous',
    tabs: tabs.map((t) => ({
      orderId: t.orderId,
      orderNumber: t.orderNumber,
      tabName: t.tabName,
      amount: Number(t.amount),
    })),
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

async function validateLeaseForPoll(
  readerId: string,
  sessionId: string,
  leaseVersion: number,
): Promise<void> {
  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT 1 FROM "PaymentReader"
     WHERE id = $1
       AND "leaseSessionId" = $2
       AND "leaseVersion" = $3
       AND "leasedUntil" > NOW()`,
    readerId,
    sessionId,
    leaseVersion,
  )

  if (rows.length === 0) {
    throw new ListenerError('stale_lease', 'Lease expired or taken', 409)
  }
}

/**
 * Check if this fingerprint was detected on this reader within the suppression window.
 * Returns true if duplicate (should suppress).
 */
async function checkAndUpdateSuppression(
  readerId: string,
  fingerprint: string,
): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT "lastDetectionFingerprint", "lastDetectionAt"
     FROM "PaymentReader"
     WHERE id = $1`,
    readerId,
  )

  if (rows.length === 0) return false

  const reader = rows[0]
  if (
    reader.lastDetectionFingerprint === fingerprint &&
    reader.lastDetectionAt &&
    Date.now() - new Date(reader.lastDetectionAt).getTime() < SUPPRESSION_WINDOW_MS
  ) {
    return true
  }

  return false
}

async function createSuppressionRecord(params: {
  readerId: string
  terminalId: string
  sessionId: string
  locationId: string
  leaseVersion: number
  fingerprint: string
  reason: 'duplicate_window' | 'dismiss_cooldown'
}): Promise<void> {
  await db.cardDetection.create({
    data: {
      detectionId: randomUUID(),
      readerId: params.readerId,
      terminalId: params.terminalId,
      sessionId: params.sessionId,
      locationId: params.locationId,
      leaseVersion: params.leaseVersion,
      matchKind: 'no_open_tab',
      status: 'suppressed',
      suppressedReason: params.reason,
      decisionExpiresAt: new Date(Date.now() + DETECTION_EXPIRY_MS),
    },
  })
}

async function setReaderState(
  readerId: string,
  sessionId: string,
  state: string,
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "PaymentReader" SET "readerState" = $1 WHERE id = $2 AND "leaseSessionId" = $3`,
    state,
    readerId,
    sessionId,
  )
}

function extractDetectionResult(detection: any): ResolveDetectionResult {
  return {
    recordNo: detection.recordNo,
    cardType: detection.cardType,
    cardLast4: detection.cardLast4,
    cardholderName: detection.cardholderName,
    entryMethod: detection.entryMethod,
    walletType: detection.walletType,
    matchKind: detection.matchKind,
    matchedOrderId: detection.matchedOrderId,
  }
}

/**
 * Classify reader/network errors into the error taxonomy.
 */
function classifyReaderError(err: unknown): string {
  if (err instanceof ListenerError) return err.code

  const message = errorMessage(err).toLowerCase()

  // Timeout errors (normal during card polling)
  if (message.includes('timeout') || message.includes('timed out') || message.includes('aborted')) {
    return 'recoverable_timeout'
  }

  // Reader busy (another transaction in progress)
  if (message.includes('busy') || message.includes('in progress') || message.includes('occupied')) {
    return 'reader_busy'
  }

  // Reader offline
  if (message.includes('econnrefused') || message.includes('unreachable') || message.includes('offline')) {
    return 'reader_offline'
  }

  // Transport/network errors
  if (
    message.includes('econnreset') ||
    message.includes('epipe') ||
    message.includes('network') ||
    message.includes('socket')
  ) {
    return 'transport_error'
  }

  return 'provider_error_unknown'
}

function classifyCardReadError(error: string | undefined): string {
  if (!error) return 'provider_error_unknown'
  const lower = error.toLowerCase()

  if (lower.includes('timeout') || lower.includes('timed out')) return 'recoverable_timeout'
  if (lower.includes('busy')) return 'reader_busy'
  if (lower.includes('offline') || lower.includes('econnrefused')) return 'reader_offline'

  return 'provider_error_unknown'
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Operation timed out')), ms)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
