/**
 * GET /api/android/update/latest
 *
 * NUC dumb proxy. Auth → cache → MC call → return. Any per-device or per-venue
 * policy belongs in MC, not here. Do not add business logic to this file.
 */

import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { z } from 'zod'
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
import {
  authenticateAndroidUpdate,
  authenticateKdsLanRequest,
  resolveCloudLocationId,
} from '../_auth'

const log = createChildLogger('android-update-proxy')

// ─── Query schema ─────────────────────────────────────────────────────────

// SOFTPOS is included for schema alignment with MC's AndroidAppKind enum,
// but SoftPOS devices do NOT use this NUC-proxy route — they update via a
// direct MC endpoint gated by trusted-WiFi on the client. Listing it here
// prevents a Zod parse error on any misrouted request; a future guard can
// 404/403 `app=SOFTPOS` requests explicitly. See SoftPOS decision doc.
const AppKind = z.enum(['REGISTER', 'PAX_A6650', 'CFD', 'KDS_PITBOSS', 'KDS_FOODKDS', 'SOFTPOS'])

const QuerySchema = z.object({
  app: AppKind,
  versionCode: z.coerce.number().int().nonnegative(),
  deviceFingerprint: z.string().min(1).max(256),
  // KDS LAN-auth path only (see _auth.ts `authenticateKdsLanRequest`).
  // Device sends whatever locationId it learned at pairing (cloud or
  // local — the auth helper resolves either form). Non-KDS apps ignore.
  locationId: z.string().min(1).optional(),
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
  // 1. Parse + validate query params (moved before auth so the KDS LAN
  //    branch can read `app` and `cloudLocationId` before deciding the
  //    auth path).
  const url = new URL(request.url)
  const parsed = QuerySchema.safeParse({
    app: url.searchParams.get('app'),
    versionCode: url.searchParams.get('versionCode'),
    deviceFingerprint: url.searchParams.get('deviceFingerprint'),
    locationId: url.searchParams.get('locationId') ?? undefined,
  })
  if (!parsed.success) {
    return jsonNoStore(
      { error: 'invalid_query', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { app, versionCode, deviceFingerprint, locationId: locationIdQuery } = parsed.data

  // 1b. SoftPOS does NOT use the NUC-proxy update path. It updates directly
  // against MC on trusted WiFi. Reject here with a machine-readable code so
  // a misconfigured client can fail loudly instead of silently trying.
  if (app === 'SOFTPOS') {
    return jsonNoStore(
      { error: 'SoftPOS uses the direct MC update endpoint, not the NUC proxy', code: 'wrong_update_path' },
      { status: 403 },
    )
  }

  // 2. Authentication — two paths:
  //    a. KDS LAN-scoped (app starts with KDS_ and cloudLocationId query matches NUC)
  //    b. Bearer Android update auth (all other apps)
  //    See docs/decisions/2026-04-18-kds-update-auth.md for the KDS rationale.
  let resolvedCloudLocationId: string | null = null

  const kdsLan = await authenticateKdsLanRequest(app, locationIdQuery ?? null)
  if (kdsLan) {
    resolvedCloudLocationId = kdsLan.cloudLocationId
  } else {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonNoStore({ error: 'Authentication required' }, { status: 401 })
    }
    const token = authHeader.slice(7).trim()
    if (!token) {
      return jsonNoStore({ error: 'Authentication required' }, { status: 401 })
    }

    const auth = await authenticateAndroidUpdate(token)
    if (!auth) {
      // Distinct machine-readable code so the device can distinguish a stale
      // pairing (recoverable by re-pair) from a transient 401 on a malformed
      // request. After N consecutive device_token_unknown responses, Phase 10
      // clients clear their stored token and return to the pairing screen.
      return jsonNoStore(
        { error: 'Invalid token', code: 'device_token_unknown' },
        { status: 401 },
      )
    }
    const terminalLocationId = auth.locationId
    resolvedCloudLocationId = await resolveCloudLocationId(terminalLocationId)
  }

  // 3. Rate limit per (deviceFingerprint, appKind).
  const gate = consumeBucket(deviceFingerprint, app)
  if (!gate.ok) {
    log.info({ path: '/api/android/update/latest', outcome: '429' })
    return jsonNoStore(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
    )
  }

  // 4. Confirm we have a cloudLocationId (resolved above either from the
  //    KDS LAN-auth path or the Bearer auth path + resolveCloudLocationId).
  const cloudLocationId = resolvedCloudLocationId
  if (!cloudLocationId) {
    return jsonNoStore(
      { error: 'Location not registered with Mission Control' },
      { status: 409 },
    )
  }

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
