// Datacap Direct API — Shared Helpers for API Routes
// Creates DatacapClient instances from location settings

import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { getPaymentSettingsCached } from '@/lib/payment-settings-cache'
import { DatacapClient } from './client'
import type { DatacapConfig } from './types'
import { POS_PACKAGE_ID, CLOUD_URLS } from './constants'
import { getReaderHealth, clearReaderHealth } from './reader-health'
import type { ReaderHealth } from './reader-health'

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

  const config: DatacapConfig = {
    merchantId: payments.datacapMerchantId || '',
    operatorId: 'POS',
    posPackageId: POS_PACKAGE_ID,
    communicationMode: payments.processor === 'simulated' ? 'simulated' : 'local',
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
  console.error('[Datacap API]', message)
  return Response.json({ error: message }, { status })
}

/**
 * Get current health status for a payment reader.
 * Useful for admin endpoints and status checks.
 */
export { getReaderHealth, clearReaderHealth }
export type { ReaderHealth }
