// Datacap Direct API — Shared Helpers for API Routes
// Creates DatacapClient instances from location settings

import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { getPaymentSettingsCached } from '@/lib/payment-settings-cache'
import { createChildLogger } from '@/lib/logger'
import { DatacapClient } from './client'
import type { DatacapConfig } from './types'
import { POS_PACKAGE_ID, CLOUD_URLS } from './constants'
import { getReaderHealth, clearReaderHealth } from './reader-health'
import type { ReaderHealth } from './reader-health'

const log = createChildLogger('datacap')

/**
 * Create a DatacapClient configured for a specific location.
 * Reads payment settings from the location's settings JSON (cached, 5min TTL).
 */
export async function getDatacapClient(locationId: string): Promise<DatacapClient> {
  const raw = await getPaymentSettingsCached(locationId)

  if (raw === null) throw new Error(`Location not found: ${locationId}`)

  const settings = parseSettings(raw)
  const payments = settings.payments

  // Map MC environment to testMode (cert → testMode=true, production → testMode=false)
  const isTestMode = payments.datacapEnvironment
    ? payments.datacapEnvironment === 'cert'
    : payments.testMode

  // ── Environment lock ──────────────────────────────────────────────────────
  // Hard-block: production credentials must never be used in a dev server.
  if (process.env.NODE_ENV === 'development' && !isTestMode) {
    throw new Error(
      '[Datacap] BLOCKED: Production credentials cannot be used while NODE_ENV=development. ' +
      'Go to Settings → Payments and set datacapEnvironment to "cert".'
    )
  }
  // Warn: cert credentials active on a production server (might be intentional, but always log it).
  if (process.env.NODE_ENV === 'production' && isTestMode) {
    log.warn(`[Datacap] WARNING: Cert/test credentials are active in production for location ${locationId}. ` +
      'Transactions will route to the Datacap cert environment — no real money will be charged.')
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Map datacapEnvironment to OperationMode for XML requests
  const operationMode: 'CERT' | 'PROD' | undefined = payments.datacapEnvironment === 'cert'
    ? 'CERT'
    : payments.datacapEnvironment === 'production'
      ? 'PROD'
      : undefined

  const config: DatacapConfig = {
    merchantId: payments.datacapMerchantId || '',
    operatorId: 'POS',
    posPackageId: POS_PACKAGE_ID,
    communicationMode: 'local',
    operationMode,
    cloudUrl: isTestMode ? CLOUD_URLS.test : CLOUD_URLS.prod,
    // Datacap cloud auth: MID as username, tokenKey as password (used for cloud mode)
    cloudUsername: payments.datacapMerchantId || '',
    cloudPassword: payments.datacapTokenKey || '',
    localTimeoutMs: (payments.readerTimeoutSeconds || 30) * 1000,
  }

  return new DatacapClient(config)
}

/**
 * Validate that the location has Datacap configured and return the client.
 * Throws if processor is 'none'.
 * Uses cached settings (5min TTL) — no extra DB call.
 */
export async function requireDatacapClient(locationId: string): Promise<DatacapClient> {
  const raw = await getPaymentSettingsCached(locationId)

  if (raw === null) throw new Error(`Location not found: ${locationId}`)

  const settings = parseSettings(raw)

  if (settings.payments.processor === 'none') {
    throw new Error('Payment processor not configured for this location')
  }

  return getDatacapClient(locationId)
}

/**
 * Validate that a reader belongs to the given location.
 */
export async function validateReader(readerId: string, locationId: string): Promise<void> {
  const reader = await db.paymentReader.findFirst({
    where: { id: readerId, locationId, deletedAt: null, isActive: true },
  })

  if (!reader) {
    throw new Error(`Active payment reader not found: ${readerId}`)
  }
}

/**
 * Parse a JSON request body with error handling.
 */
export async function parseBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T
  } catch {
    throw new Error('Invalid JSON request body')
  }
}

/**
 * Standard error response for Datacap API routes.
 * Handles both standard Error objects and DatacapError plain objects.
 */
export function datacapErrorResponse(error: unknown, status = 500) {
  let message: string
  if (error instanceof Error) {
    message = error.message
  } else if (error && typeof error === 'object' && 'text' in error) {
    // DatacapError plain object — use the text field
    message = String((error as { text: unknown }).text)
  } else {
    message = 'Internal server error'
  }
  log.error('[Datacap API]', message)
  return Response.json({ error: message }, { status })
}

/**
 * Normalize cardholder name from Datacap card reader.
 * Datacap returns "LAST/FIRST" format — convert to "First Last" for display.
 * Shared by open-tab (server-side Datacap) and record-card-auth (Android SDK).
 */
export function normalizeCardholderName(cardholderName: string | undefined): string | undefined {
  if (!cardholderName) return undefined
  const trimmed = cardholderName.trim()
  // Datacap returns "LAST/FIRST" format — convert to "First Last"
  if (trimmed.includes('/')) {
    const [last, first] = trimmed.split('/')
    const firstName = first?.trim() || ''
    const lastName = last?.trim() || ''
    if (firstName && lastName) return `${firstName} ${lastName}`
    return firstName || lastName || trimmed
  }
  // Already "FIRST LAST" format
  return trimmed
}

/**
 * Get current health status for a payment reader.
 * Useful for admin endpoints and status checks.
 */
export { getReaderHealth, clearReaderHealth }
export type { ReaderHealth }
