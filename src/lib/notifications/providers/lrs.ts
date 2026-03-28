/**
 * LRS (Long Range Systems) Notification Provider
 *
 * Implements the NotificationProvider interface for LRS paging systems.
 *
 * LRS is the second-largest restaurant paging vendor, using a cloud API
 * for pager management, alpha/numeric paging, and table tracking.
 *
 * Features:
 * - Zod config validation
 * - Configurable base URL (default: https://api.lrsus.com)
 * - API key authentication via header
 * - Vibration pattern support (1-4)
 * - Error code mapping (AUTH_FAILED, NETWORK_ERROR, RATE_LIMITED, DEVICE_NOT_FOUND)
 * - 8s timeout with AbortController
 * - testConnection() with capability detection
 */

import { z } from 'zod'
import { createChildLogger } from '@/lib/logger'
import type {
  NotificationProvider,
  NotificationCapabilities,
  TestResult,
  ProviderType,
} from '../types'

const log = createChildLogger('lrs-provider')

// ─── Config Schema ──────────────────────────────────────────────────────────

const LRSConfigSchema = z.object({
  baseUrl: z.string().url().default('https://api.lrsus.com'),
  apiKey: z.string().min(1),
  systemId: z.string().min(1),
  defaultVibrationPattern: z.number().min(1).max(4).default(1),
})

type LRSConfig = z.infer<typeof LRSConfigSchema>

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

async function lrsFetch(
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

// ─── Send Page ──────────────────────────────────────────────────────────────

async function sendPage(
  config: LRSConfig,
  pagerNumber: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<ReturnType<NotificationProvider['send']> extends Promise<infer T> ? T : never> {
  const startTime = Date.now()
  const url = `${config.baseUrl}/api/v1/pages`

  const vibrationPattern = (metadata?.vibrationPattern as number) ?? config.defaultVibrationPattern

  try {
    const { status, body, ok } = await lrsFetch(
      url,
      {
        method: 'POST',
        body: JSON.stringify({
          systemId: config.systemId,
          pagerNumber,
          message,
          vibrationPattern,
        }),
      },
      { 'X-API-Key': config.apiKey }
    )

    const latencyMs = Date.now() - startTime

    if (ok) {
      let providerMessageId: string | undefined
      try {
        const data = JSON.parse(body)
        providerMessageId = data.pageId ?? data.id
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

// ─── Capabilities ───────────────────────────────────────────────────────────

const LRS_CAPABILITIES: NotificationCapabilities = {
  canPageNumeric: true,
  canPageAlpha: true,
  canSms: false,
  canVoice: false,
  canDisplayPush: false,
  canDeviceInventory: true,
  canDeviceAssignment: false,
  canDeviceRecall: false,
  canOutOfRangeDetection: false,
  canBatteryTelemetry: false,
  canTracking: true,
  canKioskDispense: false,
  canCancellation: false,
  canDeliveryConfirmation: false,
}

// ─── Provider Implementation ────────────────────────────────────────────────

export const lrsProvider: NotificationProvider = {
  type: 'lrs' as ProviderType,

  async send(params) {
    const { targetType, targetValue, message, config: rawConfig, metadata } = params

    // Validate config
    const parseResult = LRSConfigSchema.safeParse(rawConfig)
    if (!parseResult.success) {
      return {
        success: false,
        errorCode: 'VALIDATION_ERROR',
        normalizedError: `Invalid LRS config: ${parseResult.error.message}`,
        latencyMs: 0,
      }
    }

    const config = parseResult.data

    return sendPage(config, targetValue, message, metadata)
  },

  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const startTime = Date.now()

    const parseResult = LRSConfigSchema.safeParse(config)
    if (!parseResult.success) {
      return {
        success: false,
        latencyMs: 0,
        capabilities: LRS_CAPABILITIES,
        error: `Invalid config: ${parseResult.error.message}`,
      }
    }

    const parsed = parseResult.data

    try {
      // Test: GET system status to validate API key
      const url = `${parsed.baseUrl}/api/v1/systems/${parsed.systemId}/status`
      const { ok, body } = await lrsFetch(url, { method: 'GET' }, { 'X-API-Key': parsed.apiKey })
      return {
        success: ok,
        latencyMs: Date.now() - startTime,
        capabilities: LRS_CAPABILITIES,
        rawResponse: body,
        error: ok ? undefined : 'LRS Cloud API unreachable or authentication failed',
      }
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        capabilities: LRS_CAPABILITIES,
        error: (err as Error).message,
      }
    }
  },

  getCapabilities(_config: Record<string, unknown>): NotificationCapabilities {
    return LRS_CAPABILITIES
  },
}
