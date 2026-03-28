/**
 * SMS Notification Provider
 *
 * Wraps the existing Twilio client (`src/lib/twilio.ts`) to implement
 * the NotificationProvider interface.
 *
 * Capabilities: { canSms: true } only.
 */

import { sendSMS, isTwilioConfiguredAsync, formatPhoneE164 } from '@/lib/twilio'
import { createChildLogger } from '@/lib/logger'
import type {
  NotificationProvider,
  NotificationCapabilities,
  TestResult,
  ProviderType,
} from '../types'

const log = createChildLogger('sms-provider')

// ─── Capabilities ───────────────────────────────────────────────────────────

const SMS_CAPABILITIES: NotificationCapabilities = {
  canPageNumeric: false,
  canPageAlpha: false,
  canSms: true,
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

export const smsProvider: NotificationProvider = {
  type: 'sms' as ProviderType,

  async send(params) {
    const { targetValue, message } = params
    const startTime = Date.now()

    // Check Twilio is configured
    const configured = await isTwilioConfiguredAsync()
    if (!configured) {
      return {
        success: false,
        errorCode: 'AUTH_FAILED',
        normalizedError: 'Twilio not configured — cannot send SMS',
        latencyMs: Date.now() - startTime,
      }
    }

    try {
      const result = await sendSMS({
        to: formatPhoneE164(targetValue),
        body: message,
      })

      const latencyMs = Date.now() - startTime

      if (result.success) {
        return {
          success: true,
          providerMessageId: result.messageSid,
          providerStatusCode: '200',
          deliveryConfidence: 'sent_no_confirmation',
          latencyMs,
        }
      }

      // Map Twilio errors
      const errorMsg = result.error || 'Unknown Twilio error'
      let errorCode = 'PROVIDER_ERROR'
      if (errorMsg.includes('not configured')) errorCode = 'AUTH_FAILED'
      else if (errorMsg.includes('rate') || errorMsg.includes('Rate')) errorCode = 'RATE_LIMITED'
      else if (errorMsg.includes('network') || errorMsg.includes('ECONNREFUSED')) errorCode = 'NETWORK_ERROR'
      else if (errorMsg.includes('invalid') && errorMsg.includes('number')) errorCode = 'VALIDATION_ERROR'

      return {
        success: false,
        errorCode,
        normalizedError: errorMsg,
        rawResponse: errorMsg,
        latencyMs,
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      log.error({ err }, 'SMS provider send error')
      return {
        success: false,
        errorCode: 'NETWORK_ERROR',
        normalizedError: errorMsg,
        rawResponse: errorMsg,
        latencyMs,
      }
    }
  },

  async testConnection(_config: Record<string, unknown>): Promise<TestResult> {
    const startTime = Date.now()

    const configured = await isTwilioConfiguredAsync()
    return {
      success: configured,
      latencyMs: Date.now() - startTime,
      capabilities: SMS_CAPABILITIES,
      error: configured ? undefined : 'Twilio not configured',
    }
  },

  getCapabilities(_config: Record<string, unknown>): NotificationCapabilities {
    return SMS_CAPABILITIES
  },
}
