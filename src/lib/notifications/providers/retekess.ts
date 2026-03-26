/**
 * Retekess Notification Provider
 *
 * Implements the NotificationProvider interface for Retekess budget paging systems.
 *
 * Retekess pagers are controlled via a local HTTP transmitter on the NUC network.
 * Similar to JTECH local HTTP transport.
 *
 * Transport: GET http://<ip>/send_page.php?pager=<pgr>&type=<type>&msg=<msg>
 *
 * Features:
 * - Zod config validation
 * - SSRF protection (private subnet IPs only, limited ports)
 * - executionZone: 'local_nuc' only
 * - Error code mapping (AUTH_FAILED, NETWORK_ERROR, etc.)
 * - 8s timeout with AbortController
 * - testConnection() with capability detection
 */

import { z } from 'zod'
import { createChildLogger } from '@/lib/logger'
import type {
  NotificationProvider,
  NotificationCapabilities,
  TargetType,
  TestResult,
  ProviderType,
} from '../types'

const log = createChildLogger('retekess-provider')

// ─── Config Schema ──────────────────────────────────────────────────────────

const RetekessConfigSchema = z.object({
  localIp: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Must be a valid IP address'),
  localPort: z.number().default(80),
  protocol: z.enum(['http', 'serial']).default('http'),
  defaultPagerType: z.number().min(1).max(2).default(1),
})

type RetekessConfig = z.infer<typeof RetekessConfigSchema>

// ─── SSRF Protection ────────────────────────────────────────────────────────

const ALLOWED_PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^localhost$/i,
]

const ALLOWED_PORTS = new Set([80, 8080, 9000])

function isLocalIpSafe(ip: string, port: number): boolean {
  // Check IP is in a private subnet
  const isPrivate = ALLOWED_PRIVATE_RANGES.some(re => re.test(ip))
  if (!isPrivate) {
    log.warn({ ip }, 'SSRF protection: IP not in private subnet')
    return false
  }

  // Check port is allowed
  if (!ALLOWED_PORTS.has(port)) {
    log.warn({ ip, port }, 'SSRF protection: port not in allowed list')
    return false
  }

  return true
}

// ─── Error Code Mapping ─────────────────────────────────────────────────────

function mapHttpError(status: number, body: string): { errorCode: string; normalizedError: string } {
  if (status === 401 || status === 403) {
    return { errorCode: 'AUTH_FAILED', normalizedError: 'Authentication or authorization failed' }
  }
  if (status === 429) {
    return { errorCode: 'RATE_LIMITED', normalizedError: 'Rate limit exceeded' }
  }
  if (status === 404) {
    if (body.toLowerCase().includes('pager') || body.toLowerCase().includes('device')) {
      return { errorCode: 'DEVICE_NOT_FOUND', normalizedError: 'Pager or device not found' }
    }
    return { errorCode: 'PROVIDER_ERROR', normalizedError: `Resource not found (HTTP ${status})` }
  }
  if (status >= 500) {
    return { errorCode: 'PROVIDER_ERROR', normalizedError: `Server error (HTTP ${status})` }
  }
  return { errorCode: 'PROVIDER_ERROR', normalizedError: `HTTP ${status}` }
}

function mapNetworkError(err: Error): { errorCode: string; normalizedError: string } {
  if (err.name === 'AbortError') {
    return { errorCode: 'TIMEOUT', normalizedError: 'Request timed out (8s)' }
  }
  return { errorCode: 'NETWORK_ERROR', normalizedError: err.message }
}

// ─── Shared HTTP Helper ─────────────────────────────────────────────────────

const TIMEOUT_MS = 8_000 // 8s per blueprint

async function retekessFetch(
  url: string,
  options: RequestInit = {}
): Promise<{ status: number; body: string; ok: boolean }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    const body = await res.text()
    return { status: res.status, body, ok: res.ok }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Send Page ──────────────────────────────────────────────────────────────

async function sendPage(
  config: RetekessConfig,
  pagerNumber: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<ReturnType<NotificationProvider['send']> extends Promise<infer T> ? T : never> {
  const startTime = Date.now()

  // SSRF protection
  if (!isLocalIpSafe(config.localIp, config.localPort)) {
    return {
      success: false,
      errorCode: 'VALIDATION_ERROR',
      normalizedError: 'SSRF protection: transmitter IP/port is not in an allowed private subnet',
      latencyMs: 0,
    }
  }

  // Serial transport not yet implemented
  if (config.protocol === 'serial') {
    return {
      success: false,
      errorCode: 'VALIDATION_ERROR',
      normalizedError: 'Serial transport not yet implemented for Retekess',
      latencyMs: 0,
    }
  }

  const pagerType = (metadata?.pagerType as number) ?? config.defaultPagerType
  const baseUrl = `http://${config.localIp}:${config.localPort}`
  const url = `${baseUrl}/send_page.php?pager=${encodeURIComponent(pagerNumber)}&type=${pagerType}&msg=${encodeURIComponent(message)}`

  try {
    const { status, body, ok } = await retekessFetch(url, { method: 'GET' })

    const latencyMs = Date.now() - startTime

    if (ok) {
      return {
        success: true,
        providerStatusCode: String(status),
        deliveryConfidence: 'sent_local',
        rawResponse: body,
        latencyMs,
      }
    }

    const { errorCode, normalizedError } = mapHttpError(status, body)
    return {
      success: false,
      providerStatusCode: String(status),
      rawResponse: body,
      errorCode,
      normalizedError,
      latencyMs,
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime
    const { errorCode, normalizedError } = mapNetworkError(err as Error)
    return {
      success: false,
      errorCode,
      normalizedError,
      rawResponse: (err as Error).message,
      latencyMs,
    }
  }
}

// ─── Capabilities ───────────────────────────────────────────────────────────

const RETEKESS_CAPABILITIES: NotificationCapabilities = {
  canPageNumeric: true,
  canPageAlpha: true,
  canSms: false,
  canVoice: false,
  canDisplayPush: false,
  canDeviceInventory: false,
  canDeviceAssignment: false,
  canDeviceRecall: false,
  canOutOfRangeDetection: false,
  canBatteryTelemetry: false,
  canTracking: false,
  canKioskDispense: false,
  canCancellation: false,
  canDeliveryConfirmation: false,
}

// ─── Provider Implementation ────────────────────────────────────────────────

export const retekessProvider: NotificationProvider = {
  type: 'retekess' as ProviderType,

  async send(params) {
    const { targetType, targetValue, message, config: rawConfig, metadata } = params

    // Validate config
    const parseResult = RetekessConfigSchema.safeParse(rawConfig)
    if (!parseResult.success) {
      return {
        success: false,
        errorCode: 'VALIDATION_ERROR',
        normalizedError: `Invalid Retekess config: ${parseResult.error.message}`,
        latencyMs: 0,
      }
    }

    const config = parseResult.data

    return sendPage(config, targetValue, message, metadata)
  },

  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const startTime = Date.now()

    const parseResult = RetekessConfigSchema.safeParse(config)
    if (!parseResult.success) {
      return {
        success: false,
        latencyMs: 0,
        capabilities: RETEKESS_CAPABILITIES,
        error: `Invalid config: ${parseResult.error.message}`,
      }
    }

    const parsed = parseResult.data

    // SSRF protection
    if (!isLocalIpSafe(parsed.localIp, parsed.localPort)) {
      return {
        success: false,
        latencyMs: 0,
        capabilities: RETEKESS_CAPABILITIES,
        error: 'SSRF: IP/port not in allowed private subnet',
      }
    }

    // Serial transport not testable via HTTP
    if (parsed.protocol === 'serial') {
      return {
        success: false,
        latencyMs: 0,
        capabilities: RETEKESS_CAPABILITIES,
        error: 'Serial transport not yet implemented',
      }
    }

    try {
      // Test: GET root or status endpoint of the Retekess transmitter
      const url = `http://${parsed.localIp}:${parsed.localPort}/`
      const { ok, body } = await retekessFetch(url, { method: 'GET' })
      return {
        success: ok,
        latencyMs: Date.now() - startTime,
        capabilities: RETEKESS_CAPABILITIES,
        rawResponse: body,
        error: ok ? undefined : 'Retekess local transmitter unreachable',
      }
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        capabilities: RETEKESS_CAPABILITIES,
        error: (err as Error).message,
      }
    }
  },

  getCapabilities(_config: Record<string, unknown>): NotificationCapabilities {
    return RETEKESS_CAPABILITIES
  },
}
