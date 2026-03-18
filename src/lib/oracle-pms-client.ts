/**
 * Oracle OPERA Cloud / OHIP client
 *
 * Wraps the three API calls needed for Bill to Room:
 *   1. getToken()        — OAuth client-credentials flow → JWT
 *   2. lookupByRoom()    — Find in-house guest by room number
 *   3. lookupByName()    — Find in-house guest by last name
 *   4. postCharge()      — Post F&B charge to guest folio
 *
 * Token is cached in memory per-location with a 55-minute TTL (tokens expire at 60m).
 * Safe for the NUC persistent-process environment.
 *
 * Timeouts: 8s auth, 12s lookup, 15s charge post.
 * Error sanitization: raw OPERA response bodies are never surfaced to API clients.
 */

import type { HotelPmsSettings } from '@/lib/settings'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('oracle-pms')

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PmsGuestInfo {
  reservationId: string
  roomNumber: string
  guestName: string       // "First Last" display string
  checkInDate: string     // YYYY-MM-DD
  checkOutDate: string    // YYYY-MM-DD
}

export interface PmsChargeResult {
  success: boolean
  transactionNo: string   // OPERA folio transaction number
  reservationId: string
  amount: number
  error?: string
}

// ─── Token Cache ─────────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string
  expiresAt: number       // Date.now() ms
}

// Keyed by locationId so multi-tenant is safe
const tokenCache = new Map<string, CachedToken>()

const TOKEN_TTL_MS = 55 * 60 * 1000   // 55 min (expire at 60, refresh early)

function getCachedToken(locationId: string): string | null {
  const cached = tokenCache.get(locationId)
  if (!cached) return null
  if (Date.now() >= cached.expiresAt) {
    tokenCache.delete(locationId)
    return null
  }
  return cached.accessToken
}

function setCachedToken(locationId: string, token: string): void {
  tokenCache.set(locationId, {
    accessToken: token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  })
}

// ─── Error Sanitization ───────────────────────────────────────────────────────

/**
 * Build a safe error string for server logs.
 * Truncates body to 500 chars; never exposes Authorization headers or secrets.
 */
function sanitizeForLog(status: number, body: string): string {
  const truncated = body.length > 500 ? `${body.substring(0, 500)}…` : body
  return `[OPERA ${status}] ${truncated}`
}

/**
 * Detect whether an OPERA response body contains an error payload.
 * Some OPERA environments return HTTP 200 with an error JSON body.
 * Returns a sanitized reason string, or null if no error detected.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectOperaError(data: any): string | null {
  if (!data || typeof data !== 'object') return null
  if (typeof data.message === 'string' && data.message) return `OPERA: ${data.message.substring(0, 200)}`
  if (typeof data.error === 'string' && data.error) return `OPERA: ${data.error.substring(0, 200)}`
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    const first = data.errors[0]
    const msg = typeof first === 'string' ? first : (first?.message ?? String(first))
    return `OPERA: ${String(msg).substring(0, 200)}`
  }
  if (typeof data.title === 'string' && typeof data.status === 'number' && data.status >= 400) {
    return `OPERA: ${data.title.substring(0, 200)}`
  }
  return null
}

/**
 * Extract a validated transaction ID from an OPERA charge response.
 * Returns null if the ID is missing, empty, too short, or is a known placeholder.
 *
 * Validation: non-empty, length ≥ 4, and not equal to any placeholder like "POSTED".
 * Intentionally lenient on format — both numeric and alphanumeric IDs are valid
 * (e.g. "TRX-123456" or "FOLIO-987" appear in some OPERA Cloud environments).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTransactionId(data: any): string | null {
  const PLACEHOLDERS = new Set(['POSTED', 'OK', 'SUCCESS', 'PENDING', 'UNKNOWN', ''])

  const candidates = [
    data?.transactions?.[0]?.transactionNo,
    data?.transactions?.[0]?.id,
    data?.transactionNo,
    data?.transactionId,
    data?.id,
    data?.folioTransactionNo,
  ]

  for (const candidate of candidates) {
    if (candidate == null) continue
    const str = String(candidate).trim()
    if (str.length >= 4 && !PLACEHOLDERS.has(str.toUpperCase())) {
      return str
    }
  }

  return null
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getToken(config: HotelPmsSettings, locationId: string): Promise<string> {
  const cached = getCachedToken(locationId)
  if (cached) return cached

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const url = `${config.baseUrl}/oauth/v1/tokens`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)   // 8s

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
        'x-app-key': config.appKey,
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('OPERA authentication timed out')
    throw new Error('OPERA authentication request failed')
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.error('[oracle-pms/auth]', sanitizeForLog(res.status, body))
    throw new Error(`OPERA authentication failed (HTTP ${res.status})`)
  }

  const data = await res.json() as { access_token: string }
  if (!data.access_token) throw new Error('OPERA authentication returned no access_token')

  setCachedToken(locationId, data.access_token)
  return data.access_token
}

// ─── Shared request helpers ────────────────────────────────────────────────────

async function pmsGet(
  config: HotelPmsSettings,
  locationId: string,
  path: string,
  params: Record<string, string> = {},
  timeoutMs = 12_000   // 12s guest lookup timeout
): Promise<unknown> {
  const token = await getToken(config, locationId)
  const qs = new URLSearchParams(params).toString()
  const url = `${config.baseUrl}/property/v1/${config.hotelId}/${path}${qs ? `?${qs}` : ''}`

  const makeRequest = async (bearerToken: string): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'x-app-key': config.appKey,
          'x-hotelid': config.hotelId,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new Error(`OPERA guest lookup timed out after ${timeoutMs / 1000}s`)
      throw new Error('OPERA guest lookup request failed')
    } finally {
      clearTimeout(timer)
    }
  }

  let res = await makeRequest(token)

  if (res.status === 401) {
    // Token expired server-side — clear cache and retry once
    tokenCache.delete(locationId)
    const freshToken = await getToken(config, locationId)
    res = await makeRequest(freshToken)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.error('[oracle-pms/get]', sanitizeForLog(res.status, body))
    throw new Error(`OPERA guest lookup failed (HTTP ${res.status})`)
  }

  return res.json()
}

async function pmsPost(
  config: HotelPmsSettings,
  locationId: string,
  path: string,
  body: unknown,
  timeoutMs = 15_000,   // 15s charge post timeout
  idempotencyKey?: string
): Promise<unknown> {
  const token = await getToken(config, locationId)
  const url = `${config.baseUrl}/property/v1/${config.hotelId}/${path}`

  const makeRequest = async (bearerToken: string): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'x-app-key': config.appKey,
          'x-hotelid': config.hotelId,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new Error(`OPERA charge post timed out after ${timeoutMs / 1000}s`)
      throw new Error('OPERA charge post request failed')
    } finally {
      clearTimeout(timer)
    }
  }

  let res = await makeRequest(token)

  if (res.status === 401) {
    tokenCache.delete(locationId)
    const freshToken = await getToken(config, locationId)
    res = await makeRequest(freshToken)
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    log.error('[oracle-pms/post]', sanitizeForLog(res.status, errBody))
    throw new Error(`OPERA charge post failed (HTTP ${res.status})`)
  }

  const data = await res.json()

  // Detect 200-with-error payloads — some OPERA environments return HTTP 200 for errors
  const operaErr = detectOperaError(data)
  if (operaErr) {
    log.error('[oracle-pms/post] 200-with-error:', operaErr)
    throw new Error('OPERA returned an error response — charge may not have posted')
  }

  return data
}

// ─── Parse OPERA reservation response ────────────────────────────────────────

// OPERA Cloud returns deeply nested guest data — this normalises it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseReservations(data: any): PmsGuestInfo[] {
  const list: PmsGuestInfo[] = []

  const items =
    data?.reservations?.reservationInfo ??
    data?.reservationInfo ??
    []

  for (const item of items) {
    // Reservation ID
    const idList = item?.reservationIdList
    const idObj = Array.isArray(idList) ? idList[0] : idList
    const reservationId = String(idObj?.id ?? idObj?.reservationId ?? '')

    // Room number
    const roomId = item?.roomStay?.currentRoomInfo?.roomId
      ?? item?.roomStay?.roomAssignment?.roomId
      ?? ''

    // Guest name
    const profiles = item?.guestProfiles ?? item?.guestProfiles?.profileInfo ?? []
    const firstProfile = Array.isArray(profiles) ? profiles[0] : profiles
    const personNames: Array<{nameType?: string; surname?: string; givenName?: string}> =
      firstProfile?.profileInfo?.profile?.customer?.personName
      ?? firstProfile?.profile?.customer?.personName
      ?? []
    const primary = personNames.find(n => n.nameType === 'Primary') ?? personNames[0] ?? {}
    const guestName = [primary.givenName, primary.surname].filter(Boolean).join(' ') || 'Guest'

    // Stay dates
    const checkInDate = (item?.roomStay?.arrivalDate ?? item?.arrivalDate ?? '').split('T')[0]
    const checkOutDate = (item?.roomStay?.departureDate ?? item?.departureDate ?? '').split('T')[0]

    if (reservationId && roomId) {
      list.push({ reservationId, roomNumber: String(roomId), guestName, checkInDate, checkOutDate })
    }
  }

  return list
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up in-house guests by room number.
 * Returns [] if room is unoccupied.
 */
export async function lookupByRoom(
  config: HotelPmsSettings,
  locationId: string,
  roomNumber: string
): Promise<PmsGuestInfo[]> {
  const data = await pmsGet(config, locationId, 'reservations', {
    roomNumber,
    reservationStatusType: 'INHOUSE',
  })
  return parseReservations(data)
}

/**
 * Look up in-house guests by last name (surname).
 * Returns all matches (may be more than one).
 */
export async function lookupByName(
  config: HotelPmsSettings,
  locationId: string,
  surname: string
): Promise<PmsGuestInfo[]> {
  const data = await pmsGet(config, locationId, 'reservations', {
    surname,
    reservationStatusType: 'INHOUSE',
  })
  return parseReservations(data)
}

/**
 * Post an F&B charge to the guest's folio.
 * Returns transaction number from OPERA on success.
 * Throws on failure — never returns a placeholder transaction ID.
 */
export async function postCharge(
  config: HotelPmsSettings,
  locationId: string,
  params: {
    reservationId: string
    amountCents: number          // Integer cents (e.g. 2550 = $25.50)
    description: string          // e.g. "Restaurant Charge"
    reference: string            // e.g. "GWI-POS-Order-#1234"
    folioWindowNo?: number       // Default 1 (main folio window)
    idempotencyKey?: string      // UUID for safe retry — prevents duplicate OPERA charges
  }
): Promise<PmsChargeResult> {
  const amount = params.amountCents / 100
  const today = new Date().toISOString().split('T')[0]

  const payload = {
    folioWindowNo: params.folioWindowNo ?? 1,
    transactionCode: config.chargeCode,
    transactionDate: today,
    reservationId: params.reservationId,
    postingAmount: amount,
    supplement: params.description,
    reference: params.reference,
  }

  const data = await pmsPost(config, locationId, 'folio/transactions', payload, 15_000, params.idempotencyKey)

  // Strict ID extraction — no placeholder success
  const transactionNo = extractTransactionId(data)
  if (!transactionNo) {
    throw new Error('OPERA did not return a valid transaction ID — charge status is unknown')
  }

  return {
    success: true,
    transactionNo,
    reservationId: params.reservationId,
    amount,
  }
}

/**
 * Test the connection — just tries to obtain a token.
 * Throws on failure, returns true on success.
 */
export async function testConnection(
  config: HotelPmsSettings,
  locationId: string
): Promise<boolean> {
  tokenCache.delete(locationId)
  await getToken(config, locationId)
  return true
}

/**
 * Evict the token for a location (call after credential update).
 */
export function evictToken(locationId: string): void {
  tokenCache.delete(locationId)
}
