/**
 * GET /api/android/update/latest
 *
 * NUC dumb proxy. Auth → cache → MC call → return. Any per-device or per-venue
 * policy belongs in MC, not here. Do not add business logic to this file.
 */

import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { z } from 'zod'
import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'
import {
  getAndroidUpdate,
  McFleetResponseError,
  McFleetTimeoutError,
  McFleetConfigError,
  type AndroidUpdateResponse,
} from '@/lib/mc-fleet-client'
import { recordCacheServe } from '@/lib/android-proxy-stats'
import { consumeBucket } from '@/lib/android-update-rate-limit'

const log = createChildLogger('android-update-proxy')

// ─── Query schema ─────────────────────────────────────────────────────────

const AppKind = z.enum(['REGISTER', 'PAX_A6650', 'CFD', 'KDS_PITBOSS', 'KDS_FOODKDS'])

const QuerySchema = z.object({
  app: AppKind,
  versionCode: z.coerce.number().int().nonnegative(),
  deviceFingerprint: z.string().min(1).max(256),
})

// ─── Response cache (per (cloudLocationId, appKind, versionCode)) ─────────

const CACHE_TTL_MS = 30_000

interface CacheEntry {
  expiresAt: number
  body: AndroidUpdateResponse
}

const responseCache = new Map<string, CacheEntry>()

function cacheKey(cloudLocationId: string, appKind: string, versionCode: number): string {
  return `${cloudLocationId}|${appKind}|${versionCode}`
}

// Opportunistic cache eviction (bounded size).
const CACHE_MAX = 500
function pruneCache(nowMs: number): void {
  if (responseCache.size < CACHE_MAX) return
  for (const [k, v] of responseCache) {
    if (v.expiresAt <= nowMs) responseCache.delete(k)
    if (responseCache.size < CACHE_MAX) break
  }
  // If still oversized, drop oldest insertions (Map iteration order is insertion order).
  while (responseCache.size >= CACHE_MAX) {
    const firstKey = responseCache.keys().next().value
    if (firstKey === undefined) break
    responseCache.delete(firstKey)
  }
}

// ─── NUC schema version reader (best-effort) ──────────────────────────────

const SYNC_STATUS_PATH = '/opt/gwi-pos/state/sync-status.json'

function readNucSchemaVersion(): number | undefined {
  try {
    const raw = readFileSync(SYNC_STATUS_PATH, 'utf8')
    const parsed = JSON.parse(raw) as { observedVersion?: unknown }
    const obs = parsed?.observedVersion
    if (typeof obs === 'number' && Number.isFinite(obs) && Number.isInteger(obs)) {
      return obs
    }
    if (typeof obs === 'string' && obs.length > 0) {
      // Accept "1.2.3" → 1 or "42" → 42.
      const first = obs.split('.')[0]
      const n = parseInt(first, 10)
      if (Number.isFinite(n) && n >= 0) return n
    }
    return undefined
  } catch {
    return undefined
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function jsonNoStore(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  const headers = { 'Cache-Control': 'no-store', ...(init?.headers ?? {}) }
  return NextResponse.json(body, { status: init?.status ?? 200, headers })
}

// ─── Handler ──────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // 1. Authentication — Bearer deviceToken against Terminal.
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonNoStore({ error: 'Authentication required' }, { status: 401 })
  }
  const token = authHeader.slice(7).trim()
  if (!token) {
    return jsonNoStore({ error: 'Authentication required' }, { status: 401 })
  }

  const terminal = await db.terminal.findFirst({
    where: { deviceToken: token, deletedAt: null },
    select: { id: true, locationId: true },
  })
  if (!terminal) {
    return jsonNoStore({ error: 'Invalid device token' }, { status: 401 })
  }

  // 2. Parse + validate query params.
  const url = new URL(request.url)
  const parsed = QuerySchema.safeParse({
    app: url.searchParams.get('app'),
    versionCode: url.searchParams.get('versionCode'),
    deviceFingerprint: url.searchParams.get('deviceFingerprint'),
  })
  if (!parsed.success) {
    return jsonNoStore(
      { error: 'invalid_query', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { app, versionCode, deviceFingerprint } = parsed.data

  // 3. Rate limit per (deviceFingerprint, appKind).
  const gate = consumeBucket(deviceFingerprint, app)
  if (!gate.ok) {
    log.info({ path: '/api/android/update/latest', outcome: '429' })
    return jsonNoStore(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
    )
  }

  // 4. Resolve cloudLocationId from Terminal.locationId.
  const location = await db.location.findUnique({
    where: { id: terminal.locationId },
    select: { cloudLocationId: true },
  })
  if (!location?.cloudLocationId) {
    return jsonNoStore(
      { error: 'Location not registered with Mission Control' },
      { status: 409 },
    )
  }
  const cloudLocationId = location.cloudLocationId

  // 5. Cache lookup.
  const now = Date.now()
  const key = cacheKey(cloudLocationId, app, versionCode)
  const cached = responseCache.get(key)
  if (cached && cached.expiresAt > now) {
    recordCacheServe()
    log.info({ path: '/api/android/update/latest', outcome: 'hit' })
    return jsonNoStore(cached.body)
  }
  if (cached) responseCache.delete(key)

  // 6. MC call.
  try {
    const mcResp = await getAndroidUpdate({
      app,
      cloudLocationId,
      deviceFingerprint,
      versionCode,
      nucServerVersion: process.env.npm_package_version || process.env.APP_VERSION,
      nucSchemaVersion: readNucSchemaVersion(),
    })

    pruneCache(now)
    responseCache.set(key, { expiresAt: now + CACHE_TTL_MS, body: mcResp })

    log.info({ path: '/api/android/update/latest', outcome: 'miss' })
    return jsonNoStore(mcResp)
  } catch (err) {
    if (err instanceof McFleetConfigError) {
      log.error({ path: '/api/android/update/latest', err: err.message }, 'NUC misconfigured')
      return jsonNoStore({ error: 'nuc_misconfigured' }, { status: 500 })
    }
    if (err instanceof McFleetTimeoutError) {
      log.warn({ path: '/api/android/update/latest', outcome: 'forward_err', status: 504 })
      return jsonNoStore({ error: 'mission_control_unavailable' }, { status: 502 })
    }
    if (err instanceof McFleetResponseError) {
      const status = err.status
      if (status >= 400 && status < 500) {
        log.warn({ path: '/api/android/update/latest', outcome: 'forward_err', status })
        return jsonNoStore({ error: 'mission_control_rejected_request' }, { status })
      }
      // 5xx or other
      log.warn({ path: '/api/android/update/latest', outcome: 'forward_err', status })
      return jsonNoStore({ error: 'mission_control_unavailable' }, { status: 502 })
    }
    // Network / unknown — treat as upstream unavailable.
    log.warn(
      { path: '/api/android/update/latest', outcome: 'forward_err', err: err instanceof Error ? err.message : 'unknown' },
      'MC unreachable',
    )
    return jsonNoStore({ error: 'mission_control_unavailable' }, { status: 502 })
  }
}
