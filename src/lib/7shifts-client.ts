/**
 * 7shifts API Client
 *
 * Handles OAuth client_credentials token management, required headers on every
 * request (Authorization + x-company-guid), retry logic for 429/5xx, and all
 * v1 API methods needed for the GWI POS integration.
 *
 * Token persistence strategy:
 *   - In-memory cache: best-effort within a single serverless invocation
 *   - DB persistence: required for Vercel (multiple stateless instances)
 *   - On 401: evict cache, refresh once, retry; second 401 → throw auth error
 *
 * Timeouts: 10s token fetch, 15s API calls
 * Retry: 429 + 5xx → exponential backoff + jitter, max 3 attempts
 */

import type { SevenShiftsSettings } from '@/lib/settings'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SevenShiftsUser {
  id: number
  first_name: string
  last_name: string
  email: string
  employee_id?: string
  role_ids: number[]
  department_ids: number[]
  location_ids: number[]
  is_active: boolean
}

export interface SevenShiftsLocation {
  id: number
  company_id: number
  name: string
  address?: string
  timezone?: string
}

export interface SevenShiftsShift {
  id: number
  user_id: number
  location_id: number
  department_id?: number
  role_id?: number
  start: string        // ISO8601 UTC
  end: string          // ISO8601 UTC
  break_minutes?: number
  status: string       // 'published' | 'draft' | 'deleted'
  notes?: string
}

export interface SevenShiftsTimePunchCreate {
  user_id: number
  location_id: number
  role_id?: number
  department_id?: number
  clocked_in: string   // ISO8601 UTC
  clocked_out?: string // ISO8601 UTC (omit if still clocked in)
  break_minutes?: number
  notes?: string
  // P2: Optional break segments — shape uses minutes (safer default until confirmed via sandbox).
  // 7shifts may also support { start, end } timestamps; update once verified against live API.
  breaks?: Array<{ minutes: number; paid?: boolean; type?: string }>
}

export interface SevenShiftsTimePunchResult {
  id: number
  user_id: number
  clocked_in: string
  clocked_out?: string
}

export interface SevenShiftsReceiptCreate {
  receipt_id: string      // our cuid — idempotency key
  location_id: number
  receipt_date: string    // ISO8601 UTC datetime
  net_total: number       // in cents
  tips: number            // in cents
  status: 'open' | 'closed'
  revenue_center?: string
}

export interface SevenShiftsReceiptResult {
  id: number
  receipt_id: string
}

export interface SevenShiftsWebhookCreate {
  event: string
  url: string
  method: 'post'
  secret?: string
}

export interface SevenShiftsWebhook {
  id: number
  event: string
  url: string
  method: string
}

// ─── In-Memory Token Cache ────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string
  expiresAt: number   // Date.now() ms
}

// Keyed by locationId — avoids cross-location token pollution
const tokenCache = new Map<string, CachedToken>()

const TOKEN_BUFFER_MS = 5 * 60 * 1000   // refresh 5 min before expiry

function getCachedToken(locationId: string): string | null {
  const cached = tokenCache.get(locationId)
  if (!cached) return null
  if (Date.now() >= cached.expiresAt - TOKEN_BUFFER_MS) {
    tokenCache.delete(locationId)
    return null
  }
  return cached.accessToken
}

function setCachedToken(locationId: string, token: string, expiresInSeconds: number): void {
  tokenCache.set(locationId, {
    accessToken: token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  })
}

export function evictToken(locationId: string): void {
  tokenCache.delete(locationId)
}

// ─── Base URLs ────────────────────────────────────────────────────────────────

// P0: Token endpoint is on app.7shifts.com; API calls use api.7shifts.com
const TOKEN_BASE_URL = 'https://app.7shifts.com'

function getBaseUrl(_environment: 'sandbox' | 'production'): string {
  // 7shifts uses the same domain for both; sandbox is handled by test credentials
  return 'https://api.7shifts.com'
}

// ─── Token Fetch + Persist ────────────────────────────────────────────────────

async function fetchNewToken(
  settings: SevenShiftsSettings,
  locationId: string
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
  })

  // P0: Token endpoint is on app.7shifts.com (not api.7shifts.com)
  const res = await fetch(`${TOKEN_BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[7shifts] Token fetch failed (${res.status}): ${text.slice(0, 200)}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  const { access_token, expires_in } = data

  // Cache in memory
  setCachedToken(locationId, access_token, expires_in)

  // Persist to DB so other serverless instances can reuse
  try {
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    if (location) {
      const parsed = parseSettings(location.settings)
      const updated = {
        ...parsed,
        sevenShifts: {
          ...parsed.sevenShifts,
          ...settings,
          accessToken: access_token,
          accessTokenExpiresAt: Date.now() + expires_in * 1000,
        },
      }
      await db.location.update({
        where: { id: locationId },
        data: { settings: updated as object },
      })
    }
  } catch {
    // Non-fatal — in-memory cache will serve the current invocation
  }

  return access_token
}

async function getToken(
  settings: SevenShiftsSettings,
  locationId: string
): Promise<string> {
  // 1. In-memory cache
  const cached = getCachedToken(locationId)
  if (cached) return cached

  // 2. DB-persisted token (may still be valid)
  if (settings.accessToken && settings.accessTokenExpiresAt) {
    const expiresIn = settings.accessTokenExpiresAt - Date.now()
    if (expiresIn > TOKEN_BUFFER_MS) {
      setCachedToken(locationId, settings.accessToken, expiresIn / 1000)
      return settings.accessToken
    }
  }

  // 3. Fetch a new token
  return fetchNewToken(settings, locationId)
}

// ─── Retry Wrapper ────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const is429 = lastError.message.includes('429')
      const is5xx = /50[0-9]/.test(lastError.message)
      if ((!is429 && !is5xx) || attempt === maxAttempts) throw lastError
      // Exponential backoff: 1s, 2s, 4s + jitter
      const delay = Math.pow(2, attempt - 1) * 1000 + Math.random() * 500
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError!
}

// ─── Core Request ─────────────────────────────────────────────────────────────

async function request<T>(
  settings: SevenShiftsSettings,
  locationId: string,
  method: string,
  path: string,
  body?: unknown,
  attempt = 1
): Promise<T> {
  const token = await getToken(settings, locationId)
  const baseUrl = getBaseUrl(settings.environment)

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'x-company-guid': settings.companyGuid,
    'Content-Type': 'application/json',
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })

  // Handle 401 — evict token, retry once
  if (res.status === 401) {
    if (attempt >= 2) {
      throw new Error('[7shifts] Authentication failed — check clientId, clientSecret, and companyGuid')
    }
    evictToken(locationId)
    return request<T>(settings, locationId, method, path, body, attempt + 1)
  }

  if (res.status === 429) {
    throw new Error(`[7shifts] 429 rate limit on ${method} ${path}`)
  }

  if (res.status >= 500) {
    const text = await res.text().catch(() => '')
    throw new Error(`[7shifts] ${res.status} server error on ${method} ${path}: ${text.slice(0, 200)}`)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[7shifts] ${res.status} on ${method} ${path}: ${text.slice(0, 300)}`)
  }

  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

// ─── API Methods ──────────────────────────────────────────────────────────────

/**
 * Get all users for a company (for employee mapping UI)
 */
export async function getCompanyUsers(
  settings: SevenShiftsSettings,
  locationId: string
): Promise<SevenShiftsUser[]> {
  return withRetry(async () => {
    const data = await request<{ data: SevenShiftsUser[] }>(
      settings,
      locationId,
      'GET',
      `/v2/company/${settings.companyId}/users`
    )
    return data.data ?? []
  })
}

/**
 * Get locations for a company (used to verify connection)
 */
export async function getLocations(
  settings: SevenShiftsSettings,
  locationId: string
): Promise<SevenShiftsLocation[]> {
  return withRetry(async () => {
    const data = await request<{ data: SevenShiftsLocation[] }>(
      settings,
      locationId,
      'GET',
      `/v2/company/${settings.companyId}/locations`
    )
    return data.data ?? []
  })
}

/**
 * List published shifts for a location + date range
 */
export async function listShifts(
  settings: SevenShiftsSettings,
  locationId: string,
  startDate: string,   // YYYY-MM-DD
  endDate: string      // YYYY-MM-DD
): Promise<SevenShiftsShift[]> {
  return withRetry(async () => {
    const params = new URLSearchParams({
      location_id: String(settings.locationId7s),
      start: `${startDate}T00:00:00`,
      end: `${endDate}T23:59:59`,
      status: 'published',
    })
    const data = await request<{ data: SevenShiftsShift[] }>(
      settings,
      locationId,
      'GET',
      `/v2/company/${settings.companyId}/shifts?${params}`
    )
    return data.data ?? []
  })
}

/**
 * Create a time punch for a completed clock-in/out
 */
export async function createTimePunch(
  settings: SevenShiftsSettings,
  locationId: string,
  punch: SevenShiftsTimePunchCreate
): Promise<SevenShiftsTimePunchResult> {
  return withRetry(async () => {
    const data = await request<{ data: SevenShiftsTimePunchResult }>(
      settings,
      locationId,
      'POST',
      `/v2/company/${settings.companyId}/time_punches`,
      punch
    )
    return data.data
  })
}

/**
 * Update an existing time punch (break / clock-out correction)
 */
export async function updateTimePunch(
  settings: SevenShiftsSettings,
  locationId: string,
  punchId: string | number,
  updates: Partial<SevenShiftsTimePunchCreate>
): Promise<SevenShiftsTimePunchResult> {
  return withRetry(async () => {
    const data = await request<{ data: SevenShiftsTimePunchResult }>(
      settings,
      locationId,
      'PUT',
      `/v2/company/${settings.companyId}/time_punches/${punchId}`,
      updates
    )
    return data.data
  })
}

/**
 * Push a daily sales receipt to 7shifts
 * Required fields: receipt_id, location_id, receipt_date (UTC ISO8601), net_total (cents), status
 */
export async function createReceipt(
  settings: SevenShiftsSettings,
  locationId: string,
  receipt: SevenShiftsReceiptCreate
): Promise<SevenShiftsReceiptResult> {
  return withRetry(async () => {
    const data = await request<{ data: SevenShiftsReceiptResult }>(
      settings,
      locationId,
      'POST',
      `/v2/company/${settings.companyId}/receipts`,
      receipt
    )
    return data.data
  })
}

/**
 * Register a webhook for a specific event type
 */
export async function createWebhook(
  settings: SevenShiftsSettings,
  locationId: string,
  webhook: SevenShiftsWebhookCreate
): Promise<{ id: number }> {
  return withRetry(async () => {
    const data = await request<{ data: { id: number } }>(
      settings,
      locationId,
      'POST',
      `/v2/company/${settings.companyId}/webhooks`,
      webhook
    )
    return data.data
  })
}

/**
 * List all registered webhooks for a company (for idempotent registration)
 */
export async function listWebhooks(
  settings: SevenShiftsSettings,
  locationId: string
): Promise<SevenShiftsWebhook[]> {
  return withRetry(async () => {
    const data = await request<{ data: SevenShiftsWebhook[] }>(
      settings,
      locationId,
      'GET',
      `/v2/company/${settings.companyId}/webhooks`
    )
    return data.data ?? []
  })
}

/**
 * Delete a webhook by ID
 */
export async function deleteWebhook(
  settings: SevenShiftsSettings,
  locationId: string,
  webhookId: number
): Promise<void> {
  return withRetry(async () => {
    await request<void>(
      settings,
      locationId,
      'DELETE',
      `/v2/company/${settings.companyId}/webhooks/${webhookId}`
    )
  })
}
