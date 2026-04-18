/**
 * POST /api/android/update/events
 *
 * Synchronous forward to MC. MC 2xx → we return 202. MC non-2xx / timeout →
 * we return 5xx and the device keeps the batch in its ring buffer to retry
 * on next poll. No durable NUC queue; correctness is honest status codes +
 * device ring buffer.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createChildLogger } from '@/lib/logger'
import {
  postAndroidEvents,
  McFleetResponseError,
  McFleetTimeoutError,
  McFleetConfigError,
  type AndroidEventsBody,
} from '@/lib/mc-fleet-client'
import { recordForward, recordForwardError } from '@/lib/android-proxy-stats'
import { authenticateAndroidUpdate, resolveCloudLocationId } from '../_auth'

const log = createChildLogger('android-update-proxy')

// ─── Body schema — device-facing (no cloudLocationId) ─────────────────────

const AppKind = z.enum(['REGISTER', 'PAX_A6650', 'CFD', 'KDS_PITBOSS', 'KDS_FOODKDS'])

const EventKind = z.enum([
  'CHECKED',
  'OFFERED',
  'USER_DEFERRED',
  'USER_REFUSED_INSTALL_PERMISSION',
  'INSTALL_PROMPTED',
  'INTEGRITY_FAILED',
  'INSTALL_CONFIRMED',
  'UPDATE_FAILED',
  'REQUIRED_BLOCKED',
])

const DeviceEventSchema = z.object({
  kind: EventKind,
  deviceFingerprint: z.string().min(1).max(256),
  appKind: AppKind,
  fromVersionCode: z.number().int().nonnegative().optional(),
  toVersionCode: z.number().int().nonnegative().optional(),
  releaseId: z.string().optional(),
  errorMessage: z.string().max(2000).optional(),
  occurredAt: z.string().datetime(),
})

const DeviceSnapshotSchema = z.object({
  deviceFingerprint: z.string().min(1).max(256),
  appKind: AppKind,
  installedVersionName: z.string().min(1).max(128),
  installedVersionCode: z.number().int().nonnegative(),
  deviceLabel: z.string().max(256).optional(),
  resolvedChannel: z.string(),
  lastAttemptReleaseId: z.string().optional(),
  lastAttemptVersionCode: z.number().int().nonnegative().optional(),
  lastAttemptAt: z.string().datetime().optional(),
})

const DeviceBodySchema = z.object({
  events: z.array(DeviceEventSchema).max(200),
  snapshot: DeviceSnapshotSchema,
})

// ─── Helpers ──────────────────────────────────────────────────────────────

function jsonNoStore(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  const headers = { 'Cache-Control': 'no-store', ...(init?.headers ?? {}) }
  return NextResponse.json(body, { status: init?.status ?? 200, headers })
}

// ─── Handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // 1. Authentication — Bearer accepts cellular JWT, session JWT, or WiFi
  //    device token. See _auth.ts for the Phase 4 rationale.
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

  // 2. Parse + validate body.
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return jsonNoStore({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = DeviceBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return jsonNoStore(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { events, snapshot } = parsed.data

  // 3. No rate limit on events POST — per plan §APIs, only the GET /latest
  //    endpoint is rate-limited. Events are device-driven (ring buffer
  //    retries), sharing a bucket with /latest caused same-cycle 429s.

  // 4. Resolve cloudLocationId — prefers CLOUD_LOCATION_ID env (single-venue
  //    NUC appliance), falls back to Location.cloudLocationId DB field.
  const cloudLocationId = await resolveCloudLocationId(terminalLocationId)
  if (!cloudLocationId) {
    return jsonNoStore(
      { error: 'Location not registered with Mission Control' },
      { status: 409 },
    )
  }

  // 5. Inject cloudLocationId into events + snapshot for MC contract.
  const mcBody: AndroidEventsBody = {
    events: events.map((e) => ({
      kind: e.kind,
      deviceFingerprint: e.deviceFingerprint,
      cloudLocationId,
      appKind: e.appKind,
      fromVersionCode: e.fromVersionCode ?? null,
      toVersionCode: e.toVersionCode ?? null,
      releaseId: e.releaseId ?? null,
      errorMessage: e.errorMessage ?? null,
      occurredAt: e.occurredAt,
    })),
    snapshot: {
      cloudLocationId,
      deviceFingerprint: snapshot.deviceFingerprint,
      appKind: snapshot.appKind,
      installedVersionName: snapshot.installedVersionName,
      installedVersionCode: snapshot.installedVersionCode,
      deviceLabel: snapshot.deviceLabel ?? null,
      resolvedChannel: snapshot.resolvedChannel,
      lastAttemptReleaseId: snapshot.lastAttemptReleaseId ?? null,
      lastAttemptVersionCode: snapshot.lastAttemptVersionCode ?? null,
      lastAttemptAt: snapshot.lastAttemptAt ?? null,
    },
  }

  // 6. Forward to MC synchronously.
  try {
    const mcResp = await postAndroidEvents(mcBody)
    recordForward(events.length)
    log.info({
      path: '/api/android/update/events',
      outcome: 'forward_ok',
      eventCount: events.length,
      accepted: mcResp.accepted,
    })
    return jsonNoStore({ accepted: mcResp.accepted }, { status: 202 })
  } catch (err) {
    if (err instanceof McFleetConfigError) {
      recordForwardError(err.message)
      log.error({ path: '/api/android/update/events', err: err.message }, 'NUC misconfigured')
      return jsonNoStore({ error: 'nuc_misconfigured' }, { status: 500 })
    }
    if (err instanceof McFleetTimeoutError) {
      recordForwardError(err.message)
      log.warn({ path: '/api/android/update/events', outcome: 'forward_err', status: 504 })
      return jsonNoStore({ error: 'mission_control_timeout' }, { status: 504 })
    }
    if (err instanceof McFleetResponseError) {
      recordForwardError(err.message, err.status)
      // Per plan: any MC non-2xx → 502 to device so it retries via ring buffer.
      // 4xx from MC indicates malformed batch — still 502, but log loudly.
      if (err.status >= 400 && err.status < 500) {
        // Include MC's response body + a redacted snapshot hint so the exact
        // field triggering the 4xx is visible without a re-roll-out.
        log.error(
          {
            path: '/api/android/update/events',
            outcome: 'forward_err',
            mcStatus: err.status,
            mcBody: err.body,
            snapshotKeys: {
              appKind: snapshot.appKind,
              installedVersionCode: snapshot.installedVersionCode,
              resolvedChannel: snapshot.resolvedChannel,
              eventKinds: events.map((e) => e.kind),
            },
          },
          'MC rejected events batch (4xx) — device will retry; investigate payload shape',
        )
      } else {
        log.warn({ path: '/api/android/update/events', outcome: 'forward_err', mcStatus: err.status })
      }
      return jsonNoStore({ error: 'mission_control_unavailable' }, { status: 502 })
    }
    // Network / unknown.
    const msg = err instanceof Error ? err.message : 'unknown'
    recordForwardError(msg)
    log.warn(
      { path: '/api/android/update/events', outcome: 'forward_err', err: msg },
      'MC unreachable',
    )
    return jsonNoStore({ error: 'mission_control_unavailable' }, { status: 502 })
  }
}
