/**
 * JTECH Notification Provider
 *
 * Implements the NotificationProvider interface for JTECH paging systems.
 *
 * Three transports:
 * 1. CloudAlert — JTECH Cloud API (HTTP REST)
 * 2. Direct SMS — SMS via JTECH's SMS gateway
 * 3. Local HTTP — Direct HTTP to JTECH transmitter on local NUC network
 *
 * Features:
 * - Zod config validation
 * - SSRF protection for local HTTP (private subnet IPs only, limited ports)
 * - Error code mapping (AUTH_FAILED, NETWORK_ERROR, RATE_LIMITED, DEVICE_NOT_FOUND)
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

const log = createChildLogger('jtech-provider')

// ─── Config Schema ──────────────────────────────────────────────────────────

const JtechCloudConfigSchema = z.object({
  transport: z.literal('cloud_alert'),
  apiUrl: z.string().url(),
  apiKey: z.string().min(1),
  siteId: z.string().min(1),
  customerId: z.string().optional(),
})

const JtechSmsConfigSchema = z.object({
  transport: z.literal('direct_sms'),
  smsGatewayUrl: z.string().url(),
  apiKey: z.string().min(1),
  fromNumber: z.string().optional(),
})

const JtechLocalConfigSchema = z.object({
  transport: z.literal('local_http'),
  transmitterUrl: z.string().url(),
  authToken: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
})

const JtechConfigSchema = z.discriminatedUnion('transport', [
  JtechCloudConfigSchema,
  JtechSmsConfigSchema,
  JtechLocalConfigSchema,
])

type JtechConfig = z.infer<typeof JtechConfigSchema>

// ─── SSRF Protection ────────────────────────────────────────────────────────

const ALLOWED_PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^localhost$/i,
]

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443, 9090])

function isLocalUrlSafe(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    const hostname = url.hostname
    const port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80)

    // Check hostname is in a private subnet
    const isPrivate = ALLOWED_PRIVATE_RANGES.some(re => re.test(hostname))
    if (!isPrivate) {
      log.warn({ hostname }, 'SSRF protection: hostname not in private subnet')
      return false
    }

    // Check port is allowed
    if (!ALLOWED_PORTS.has(port)) {
      log.warn({ hostname, port }, 'SSRF protection: port not in allowed list')
      return false
    }

    return true
  } catch {
    return false
  }
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
    // Check if it's a device/pager not found
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

async function jtechFetch(
  url: string,
  options: RequestInit,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string; ok: boolean }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      signal: controller.signal,
    })
    const body = await res.text()
    return { status: res.status, body, ok: res.ok }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Transport: Cloud Alert ─────────────────────────────────────────────────

async function sendCloudAlert(
  config: z.infer<typeof JtechCloudConfigSchema>,
  pagerNumber: string,
  message: string
): Promise<ReturnType<NotificationProvider['send']> extends Promise<infer T> ? T : never> {
  const startTime = Date.now()
  const url = `${config.apiUrl}/api/v1/alerts`

  try {
    const { status, body, ok } = await jtechFetch(
      url,
      {
        method: 'POST',
        body: JSON.stringify({
          siteId: config.siteId,
          pagerNumber,
          message,
          customerId: config.customerId,
        }),
      },
      { 'X-API-Key': config.apiKey }
    )

    const latencyMs = Date.now() - startTime

    if (ok) {
      let providerMessageId: string | undefined
      try {
        const data = JSON.parse(body)
        providerMessageId = data.alertId ?? data.id
      } catch { /* not JSON */ }

      return {
        success: true,
        providerMessageId,
        providerStatusCode: String(status),
        deliveryConfidence: 'sent_no_confirmation',
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

// ─── Transport: Direct SMS ──────────────────────────────────────────────────

async function sendDirectSms(
  config: z.infer<typeof JtechSmsConfigSchema>,
  phoneNumber: string,
  message: string
): Promise<ReturnType<NotificationProvider['send']> extends Promise<infer T> ? T : never> {
  const startTime = Date.now()
  const url = `${config.smsGatewayUrl}/api/v1/sms`

  try {
    const { status, body, ok } = await jtechFetch(
      url,
      {
        method: 'POST',
        body: JSON.stringify({
          to: phoneNumber,
          message,
          from: config.fromNumber,
        }),
      },
      { 'X-API-Key': config.apiKey }
    )

    const latencyMs = Date.now() - startTime

    if (ok) {
      let providerMessageId: string | undefined
      try {
        const data = JSON.parse(body)
        providerMessageId = data.messageId ?? data.id
      } catch { /* not JSON */ }

      return {
        success: true,
        providerMessageId,
        providerStatusCode: String(status),
        deliveryConfidence: 'sent_no_confirmation',
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

// ─── Transport: Local HTTP ──────────────────────────────────────────────────

async function sendLocalHttp(
  config: z.infer<typeof JtechLocalConfigSchema>,
  pagerNumber: string,
  message: string
): Promise<ReturnType<NotificationProvider['send']> extends Promise<infer T> ? T : never> {
  const startTime = Date.now()

  // SSRF protection
  if (!isLocalUrlSafe(config.transmitterUrl)) {
    return {
      success: false,
      errorCode: 'VALIDATION_ERROR',
      normalizedError: 'SSRF protection: transmitter URL is not in an allowed private subnet',
      latencyMs: 0,
    }
  }

  const url = `${config.transmitterUrl}/page`

  try {
    const headers: Record<string, string> = {}
    if (config.authToken) {
      headers['Authorization'] = `Bearer ${config.authToken}`
    }

    const { status, body, ok } = await jtechFetch(
      url,
      {
        method: 'POST',
        body: JSON.stringify({
          pagerNumber,
          message,
        }),
      },
      headers
    )

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

// ─── Provider Implementation ────────────────────────────────────────────────

export const jtechProvider: NotificationProvider = {
  type: 'jtech' as ProviderType,

  async send(params) {
    const { targetType, targetValue, message, config: rawConfig } = params

    // Validate config
    const parseResult = JtechConfigSchema.safeParse(rawConfig)
    if (!parseResult.success) {
      return {
        success: false,
        errorCode: 'VALIDATION_ERROR',
        normalizedError: `Invalid JTECH config: ${parseResult.error.message}`,
        latencyMs: 0,
      }
    }

    const config = parseResult.data

    switch (config.transport) {
      case 'cloud_alert':
        return sendCloudAlert(config, targetValue, message)

      case 'direct_sms':
        return sendDirectSms(config, targetValue, message)

      case 'local_http':
        return sendLocalHttp(config, targetValue, message)

      default:
        return {
          success: false,
          errorCode: 'VALIDATION_ERROR',
          normalizedError: `Unknown transport: ${(config as any).transport}`,
          latencyMs: 0,
        }
    }
  },

  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const startTime = Date.now()

    const parseResult = JtechConfigSchema.safeParse(config)
    if (!parseResult.success) {
      return {
        success: false,
        latencyMs: 0,
        capabilities: jtechProvider.getCapabilities(config),
        error: `Invalid config: ${parseResult.error.message}`,
      }
    }

    const parsed = parseResult.data

    try {
      switch (parsed.transport) {
        case 'cloud_alert': {
          // Test: GET system status
          const url = `${parsed.apiUrl}/api/v1/status`
          const { ok, body } = await jtechFetch(url, { method: 'GET' }, { 'X-API-Key': parsed.apiKey })
          return {
            success: ok,
            latencyMs: Date.now() - startTime,
            capabilities: jtechProvider.getCapabilities(config),
            rawResponse: body,
            error: ok ? undefined : 'JTECH Cloud API unreachable',
          }
        }

        case 'direct_sms': {
          const url = `${parsed.smsGatewayUrl}/api/v1/status`
          const { ok, body } = await jtechFetch(url, { method: 'GET' }, { 'X-API-Key': parsed.apiKey })
          return {
            success: ok,
            latencyMs: Date.now() - startTime,
            capabilities: jtechProvider.getCapabilities(config),
            rawResponse: body,
            error: ok ? undefined : 'JTECH SMS gateway unreachable',
          }
        }

        case 'local_http': {
          if (!isLocalUrlSafe(parsed.transmitterUrl)) {
            return {
              success: false,
              latencyMs: 0,
              capabilities: jtechProvider.getCapabilities(config),
              error: 'SSRF: URL not in allowed private subnet',
            }
          }
          const url = `${parsed.transmitterUrl}/status`
          const headers: Record<string, string> = {}
          if (parsed.authToken) headers['Authorization'] = `Bearer ${parsed.authToken}`
          const { ok, body } = await jtechFetch(url, { method: 'GET' }, headers)
          return {
            success: ok,
            latencyMs: Date.now() - startTime,
            capabilities: jtechProvider.getCapabilities(config),
            rawResponse: body,
            error: ok ? undefined : 'JTECH local transmitter unreachable',
          }
        }
      }
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        capabilities: jtechProvider.getCapabilities(config),
        error: (err as Error).message,
      }
    }
  },

  getCapabilities(config: Record<string, unknown>): NotificationCapabilities {
    const parseResult = JtechConfigSchema.safeParse(config)
    const transport = parseResult.success ? parseResult.data.transport : 'cloud_alert'

    return {
      canPageNumeric: transport !== 'direct_sms',
      canPageAlpha: transport === 'cloud_alert',
      canSms: transport === 'direct_sms',
      canVoice: false,
      canDisplayPush: false,
      canDeviceInventory: transport === 'cloud_alert',
      canDeviceAssignment: transport === 'cloud_alert',
      canDeviceRecall: transport !== 'direct_sms',
      canOutOfRangeDetection: transport === 'cloud_alert',
      canBatteryTelemetry: transport === 'cloud_alert',
      canTracking: false,
      canKioskDispense: false,
      canCancellation: transport === 'cloud_alert',
      canDeliveryConfirmation: false,
    }
  },

  async recallDevice(params) {
    // Only supported for local_http transport
    return { success: false, error: 'recallDevice not yet implemented for JTECH' }
  },
}
