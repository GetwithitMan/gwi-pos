/**
 * McFleetClient — HMAC-authenticated NUC → MC client for Android update
 * metadata. Mirrors the signing scheme used by heartbeat.sh
 * (public/installer-modules/04-database.sh) and update-agent.ts. Uses per-NUC
 * SERVER_API_KEY as the HMAC secret; no new env vars.
 */

import { createHmac } from 'crypto'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('mc-fleet-client')

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AndroidUpdateQuery {
  app: 'REGISTER' | 'PAX_A6650' | 'CFD' | 'KDS_PITBOSS' | 'KDS_FOODKDS'
  cloudLocationId: string
  deviceFingerprint: string
  versionCode: number
  nucServerVersion?: string
  nucSchemaVersion?: number
}

export interface AndroidUpdateResponse {
  pollAfterSeconds: number
  channel: string
  upToDate: boolean
  release?: {
    releaseId: string
    versionName: string
    versionCode: number
    publishedAt: string
    downloadUrl: string
    artifactSha256: string
    artifactSize: number
    signingCertSha256s: string[]
    packageName: string
    releaseNotes: string | null
    isRequired: boolean
    minSupportedVersionCode: number | null
    blockingReason: string | null
    forceGraceSeconds: number
  }
}

export interface AndroidEventsBody {
  events: Array<{
    kind: string
    deviceFingerprint: string
    cloudLocationId: string
    appKind: string
    fromVersionCode?: number | null
    toVersionCode?: number | null
    releaseId?: string | null
    errorMessage?: string | null
    occurredAt: string
  }>
  snapshot: {
    cloudLocationId: string
    deviceFingerprint: string
    appKind: string
    installedVersionName: string
    installedVersionCode: number
    deviceLabel?: string | null
    resolvedChannel: string
    lastAttemptReleaseId?: string | null
    lastAttemptVersionCode?: number | null
    lastAttemptAt?: string | null
  }
}

export interface AndroidEventsResponse {
  accepted: number
}

export class McFleetResponseError extends Error {
  public readonly status: number
  public readonly body?: string
  constructor(status: number, message: string, body?: string) {
    super(message)
    this.name = 'McFleetResponseError'
    this.status = status
    this.body = body
  }
}

export class McFleetTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McFleetTimeoutError'
  }
}

export class McFleetConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McFleetConfigError'
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ResolvedConfig {
  mcUrl: string
  apiKey: string
  nodeId: string
  fingerprint: string
}

let backofficeFallbackWarned = false

function resolveConfig(): ResolvedConfig {
  const mcRaw = process.env.MISSION_CONTROL_URL
  const legacyRaw = process.env.BACKOFFICE_API_URL

  if (!mcRaw && legacyRaw && !backofficeFallbackWarned) {
    // Mirrors update-agent.ts:570-573 — one-shot deprecation notice.
    console.warn('[DEPRECATED] Using BACKOFFICE_API_URL — migrate to MISSION_CONTROL_URL')
    backofficeFallbackWarned = true
  }

  const mcUrl = (mcRaw || legacyRaw || '').replace(/\/+$/, '')
  const apiKey = process.env.SERVER_API_KEY || ''
  const nodeId = process.env.SERVER_NODE_ID || ''
  const fingerprint = process.env.HARDWARE_FINGERPRINT || ''

  const missing: string[] = []
  if (!mcUrl) missing.push('MISSION_CONTROL_URL')
  if (!apiKey) missing.push('SERVER_API_KEY')
  if (!nodeId) missing.push('SERVER_NODE_ID')
  if (!fingerprint) missing.push('HARDWARE_FINGERPRINT')

  if (missing.length > 0) {
    throw new McFleetConfigError(
      `mc-fleet-client: missing required env vars: ${missing.join(', ')}`,
    )
  }

  return { mcUrl, apiKey, nodeId, fingerprint }
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function buildHeaders(
  cfg: ResolvedConfig,
  signature: string,
  withJsonContentType: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'X-Server-Node-Id': cfg.nodeId,
    'X-Hardware-Fingerprint': cfg.fingerprint,
    'X-Request-Signature': signature,
  }
  if (withJsonContentType) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetryStatus(status: number): boolean {
  // Retry on timeouts, rate-limits, and server errors — never on other 4xx.
  return status === 408 || status === 429 || (status >= 500 && status < 600)
}

async function readBodyPreview(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text()
    if (!text) return undefined
    return text.slice(0, 512)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// GET /api/fleet/android/update
// ---------------------------------------------------------------------------

export async function getAndroidUpdate(q: AndroidUpdateQuery): Promise<AndroidUpdateResponse> {
  const cfg = resolveConfig()

  const params = new URLSearchParams()
  params.set('app', q.app)
  params.set('cloudLocationId', q.cloudLocationId)
  params.set('deviceFingerprint', q.deviceFingerprint)
  params.set('versionCode', String(q.versionCode))
  if (q.nucServerVersion) params.set('nucServerVersion', q.nucServerVersion)
  if (typeof q.nucSchemaVersion === 'number') {
    params.set('nucSchemaVersion', String(q.nucSchemaVersion))
  }

  const path = '/api/fleet/android/update'
  const url = `${cfg.mcUrl}${path}?${params.toString()}`

  // GET signs an empty body.
  const signature = sign('', cfg.apiKey)
  const headers = buildHeaders(cfg, signature, false)

  const backoffs = [0, 300, 900] // attempt 1 immediate, then 300ms, then 900ms
  let lastErr: unknown

  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    if (backoffs[attempt] > 0) {
      await sleep(backoffs[attempt])
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5_000),
      })
    } catch (err) {
      lastErr = err
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (isAbort) {
        log.warn({ path, attempt }, 'mc-fleet-client GET timed out')
      } else {
        log.warn({ path, attempt }, 'mc-fleet-client GET network error')
      }
      // Retry on network/timeout errors.
      if (attempt < backoffs.length - 1) continue
      if (isAbort) {
        throw new McFleetTimeoutError(`mc-fleet-client: GET ${path} timed out after 5s`)
      }
      throw err
    }

    if (res.ok) {
      try {
        return (await res.json()) as AndroidUpdateResponse
      } catch (err) {
        // Bad JSON from MC is non-retryable — surface it.
        throw new McFleetResponseError(
          res.status,
          `mc-fleet-client: GET ${path} returned invalid JSON`,
          err instanceof Error ? err.message : undefined,
        )
      }
    }

    const bodyPreview = await readBodyPreview(res)
    log.warn({ path, status: res.status, attempt }, 'mc-fleet-client GET non-2xx')

    if (!shouldRetryStatus(res.status) || attempt === backoffs.length - 1) {
      throw new McFleetResponseError(
        res.status,
        `mc-fleet-client: GET ${path} failed with ${res.status}`,
        bodyPreview,
      )
    }
    // Otherwise, loop and retry.
  }

  // Should be unreachable — final iteration always throws.
  throw (lastErr instanceof Error
    ? lastErr
    : new Error('mc-fleet-client: GET failed with no error recorded'))
}

// ---------------------------------------------------------------------------
// POST /api/fleet/android/events
// ---------------------------------------------------------------------------

export async function postAndroidEvents(b: AndroidEventsBody): Promise<AndroidEventsResponse> {
  const cfg = resolveConfig()

  const path = '/api/fleet/android/events'
  const url = `${cfg.mcUrl}${path}`
  const bodyString = JSON.stringify(b)
  const signature = sign(bodyString, cfg.apiKey)
  const headers = buildHeaders(cfg, signature, true)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyString,
      signal: AbortSignal.timeout(5_000),
    })
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    if (isAbort) {
      log.warn({ path }, 'mc-fleet-client POST timed out')
      throw new McFleetTimeoutError(`mc-fleet-client: POST ${path} timed out after 5s`)
    }
    log.warn({ path }, 'mc-fleet-client POST network error')
    throw err
  }

  if (!res.ok) {
    const bodyPreview = await readBodyPreview(res)
    log.warn({ path, status: res.status }, 'mc-fleet-client POST non-2xx')
    throw new McFleetResponseError(
      res.status,
      `mc-fleet-client: POST ${path} failed with ${res.status}`,
      bodyPreview,
    )
  }

  try {
    const data = (await res.json()) as Partial<AndroidEventsResponse>
    const accepted = typeof data?.accepted === 'number' ? data.accepted : 0
    return { accepted }
  } catch (err) {
    throw new McFleetResponseError(
      res.status,
      `mc-fleet-client: POST ${path} returned invalid JSON`,
      err instanceof Error ? err.message : undefined,
    )
  }
}
