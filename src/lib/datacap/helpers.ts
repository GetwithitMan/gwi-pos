// Datacap Direct API — Shared Helpers for API Routes
// Creates DatacapClient instances from location settings

import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { DatacapClient } from './client'
import type { DatacapConfig } from './types'
import { POS_PACKAGE_ID, CLOUD_URLS } from './constants'

/**
 * Create a DatacapClient configured for a specific location.
 * Reads payment settings from the location's settings JSON.
 */
export async function getDatacapClient(locationId: string): Promise<DatacapClient> {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { settings: true },
  })

  if (!location) throw new Error(`Location not found: ${locationId}`)

  const settings = parseSettings(location.settings)
  const payments = settings.payments

  const config: DatacapConfig = {
    merchantId: payments.datacapMerchantId || '',
    operatorId: 'POS',
    posPackageId: POS_PACKAGE_ID,
    communicationMode: payments.processor === 'simulated' ? 'local' : 'local',
    cloudUrl: payments.testMode ? CLOUD_URLS.test : CLOUD_URLS.prod,
    localTimeoutMs: (payments.readerTimeoutSeconds || 30) * 1000,
  }

  return new DatacapClient(config)
}

/**
 * Validate that the location has Datacap configured and return the client.
 * Throws if processor is 'none'.
 */
export async function requireDatacapClient(locationId: string): Promise<DatacapClient> {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { settings: true },
  })

  if (!location) throw new Error(`Location not found: ${locationId}`)

  const settings = parseSettings(location.settings)

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
 */
export function datacapErrorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Internal server error'
  console.error('[Datacap API]', message)
  return Response.json({ error: message }, { status })
}
