/**
 * Simulator Notification Provider
 *
 * For development, testing, and dry-run modes.
 *
 * Supports configurable behaviors via config:
 * - fake-pager: Always succeeds, simulates pager send
 * - fake-sms: Always succeeds, simulates SMS send
 * - fail-sometimes: Randomly fails ~30% of sends
 * - slow-provider: Always succeeds but adds 2-5s latency
 */

import { createChildLogger } from '@/lib/logger'
import type {
  NotificationProvider,
  NotificationCapabilities,
  TestResult,
} from '../types'

const log = createChildLogger('simulator-provider')

// ─── Simulator Modes ────────────────────────────────────────────────────────

type SimulatorMode = 'fake-pager' | 'fake-sms' | 'fail-sometimes' | 'slow-provider'

function getMode(config: Record<string, unknown>): SimulatorMode {
  const mode = config.mode as string | undefined
  if (mode && ['fake-pager', 'fake-sms', 'fail-sometimes', 'slow-provider'].includes(mode)) {
    return mode as SimulatorMode
  }
  return 'fake-pager'
}

// ─── Capabilities per Mode ──────────────────────────────────────────────────

function getCapabilitiesForMode(mode: SimulatorMode): NotificationCapabilities {
  const base: NotificationCapabilities = {
    canPageNumeric: false,
    canPageAlpha: false,
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

  switch (mode) {
    case 'fake-pager':
      return { ...base, canPageNumeric: true, canPageAlpha: true, canDeviceRecall: true }
    case 'fake-sms':
      return { ...base, canSms: true }
    case 'fail-sometimes':
      return { ...base, canPageNumeric: true, canSms: true }
    case 'slow-provider':
      return { ...base, canPageNumeric: true, canPageAlpha: true, canSms: true }
  }
}

// ─── Provider Implementation ────────────────────────────────────────────────

export const simulatorProvider: NotificationProvider = {
  type: 'simulator', // W9: Use dedicated simulator type instead of misleading 'sms'

  async send(params) {
    const { targetType, targetValue, message, config: rawConfig } = params
    const mode = getMode(rawConfig)
    const startTime = Date.now()

    log.info(
      { mode, targetType, targetValue, messageLength: message.length },
      'Simulator: send notification'
    )

    switch (mode) {
      case 'fake-pager': {
        return {
          success: true,
          providerMessageId: `sim-pager-${Date.now()}`,
          providerStatusCode: '200',
          deliveryConfidence: 'simulated',
          rawResponse: JSON.stringify({ simulated: true, mode: 'fake-pager', pagerNumber: targetValue }),
          latencyMs: Date.now() - startTime,
        }
      }

      case 'fake-sms': {
        return {
          success: true,
          providerMessageId: `sim-sms-${Date.now()}`,
          providerStatusCode: '200',
          deliveryConfidence: 'simulated',
          rawResponse: JSON.stringify({ simulated: true, mode: 'fake-sms', to: targetValue }),
          latencyMs: Date.now() - startTime,
        }
      }

      case 'fail-sometimes': {
        const shouldFail = Math.random() < 0.3 // 30% failure rate
        if (shouldFail) {
          const errorTypes = ['NETWORK_ERROR', 'PROVIDER_ERROR', 'TIMEOUT'] as const
          const errorCode = errorTypes[Math.floor(Math.random() * errorTypes.length)]
          return {
            success: false,
            errorCode,
            normalizedError: `Simulated failure (${errorCode})`,
            rawResponse: JSON.stringify({ simulated: true, mode: 'fail-sometimes', error: errorCode }),
            latencyMs: Date.now() - startTime,
          }
        }
        return {
          success: true,
          providerMessageId: `sim-maybe-${Date.now()}`,
          providerStatusCode: '200',
          deliveryConfidence: 'simulated',
          rawResponse: JSON.stringify({ simulated: true, mode: 'fail-sometimes', passed: true }),
          latencyMs: Date.now() - startTime,
        }
      }

      case 'slow-provider': {
        // Add 2-5s of simulated latency
        const delay = 2000 + Math.random() * 3000
        await new Promise(resolve => setTimeout(resolve, delay))
        return {
          success: true,
          providerMessageId: `sim-slow-${Date.now()}`,
          providerStatusCode: '200',
          deliveryConfidence: 'simulated',
          rawResponse: JSON.stringify({ simulated: true, mode: 'slow-provider', delayMs: Math.round(delay) }),
          latencyMs: Date.now() - startTime,
        }
      }
    }
  },

  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const mode = getMode(config)
    return {
      success: true,
      latencyMs: 1,
      capabilities: getCapabilitiesForMode(mode),
      rawResponse: JSON.stringify({ simulator: true, mode }),
    }
  },

  getCapabilities(config: Record<string, unknown>): NotificationCapabilities {
    return getCapabilitiesForMode(getMode(config))
  },
}
