/**
 * Voice Notification Provider
 *
 * Wraps the existing Twilio client to implement the NotificationProvider
 * interface for outbound voice calls with TwiML text-to-speech.
 *
 * Uses shared Twilio credentials from TwilioSettings (same as SMS provider).
 *
 * Capabilities: { canVoice: true } only.
 * executionZone: 'any'
 */

import { z } from 'zod'
import { getClient, isTwilioConfiguredAsync, formatPhoneE164, loadCredentials } from '@/lib/twilio'
import { createChildLogger } from '@/lib/logger'
import type {
  NotificationProvider,
  NotificationCapabilities,
  TestResult,
  ProviderType,
} from '../types'

const log = createChildLogger('voice-provider')

// ─── Config Schema ──────────────────────────────────────────────────────────

export const VoiceConfigSchema = z.object({
  voiceType: z.enum(['alice', 'man', 'woman']).default('alice'),
  language: z.string().default('en-US'),
  repeatCount: z.number().min(1).max(3).default(2),
  callTimeout: z.number().default(30),
})

export type VoiceConfig = z.infer<typeof VoiceConfigSchema>

// ─── Capabilities ───────────────────────────────────────────────────────────

const VOICE_CAPABILITIES: NotificationCapabilities = {
  canPageNumeric: false,
  canPageAlpha: false,
  canSms: false,
  canVoice: true,
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

// ─── TwiML Builder ──────────────────────────────────────────────────────────

/**
 * Build TwiML XML for a voice call with <Say> verb.
 * Repeats the message `repeatCount` times with a brief pause between.
 */
function buildTwiml(message: string, config: VoiceConfig): string {
  const voiceAttr = config.voiceType === 'alice'
    ? `voice="alice" language="${config.language}"`
    : `voice="${config.voiceType}"`

  const sayBlocks: string[] = []
  for (let i = 0; i < config.repeatCount; i++) {
    sayBlocks.push(`<Say ${voiceAttr}>${escapeXml(message)}</Say>`)
    if (i < config.repeatCount - 1) {
      sayBlocks.push('<Pause length="1"/>')
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?><Response>${sayBlocks.join('')}</Response>`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ─── Error Code Mapping ─────────────────────────────────────────────────────

function mapTwilioError(err: Error): { errorCode: string; normalizedError: string } {
  const msg = err.message || ''

  // Auth failures
  if (msg.includes('Authenticate') || msg.includes('credential') || msg.includes('401') || msg.includes('403')) {
    return { errorCode: 'AUTH_FAILED', normalizedError: 'Twilio authentication failed' }
  }

  // Network / timeout
  if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('network') || msg.includes('timeout')) {
    return { errorCode: 'NETWORK_ERROR', normalizedError: `Network error: ${msg}` }
  }

  // Invalid phone number (Twilio error codes 21211, 21214)
  if (msg.includes('not a valid phone') || msg.includes('invalid') || msg.includes('unverified') || msg.includes('21211') || msg.includes('21214')) {
    return { errorCode: 'VALIDATION_ERROR', normalizedError: `Invalid phone number: ${msg}` }
  }

  // Rate limited
  if (msg.includes('rate') || msg.includes('Rate') || msg.includes('429')) {
    return { errorCode: 'RATE_LIMITED', normalizedError: 'Rate limited by Twilio' }
  }

  return { errorCode: 'PROVIDER_ERROR', normalizedError: msg }
}

// ─── Provider Implementation ────────────────────────────────────────────────

export const voiceProvider: NotificationProvider = {
  type: 'voice' as ProviderType,

  async send(params) {
    const { targetValue, message, config: rawConfig } = params
    const startTime = Date.now()

    // Parse config with defaults
    const parseResult = VoiceConfigSchema.safeParse(rawConfig)
    const voiceConfig = parseResult.success ? parseResult.data : VoiceConfigSchema.parse({})

    // Check Twilio is configured
    const configured = await isTwilioConfiguredAsync()
    if (!configured) {
      return {
        success: false,
        errorCode: 'AUTH_FAILED',
        normalizedError: 'Twilio not configured — cannot make voice calls',
        latencyMs: Date.now() - startTime,
      }
    }

    try {
      const client = await getClient()
      const creds = await loadCredentials()

      if (!creds.fromNumber) {
        return {
          success: false,
          errorCode: 'AUTH_FAILED',
          normalizedError: 'Twilio fromNumber not configured',
          latencyMs: Date.now() - startTime,
        }
      }

      // Build default message if none provided
      const twimlMessage = message || 'Your order is ready for pickup. Thank you.'
      const twiml = buildTwiml(twimlMessage, voiceConfig)
      const toPhone = formatPhoneE164(targetValue)

      const call = await client.calls.create({
        twiml,
        to: toPhone,
        from: creds.fromNumber,
        timeout: voiceConfig.callTimeout,
      })

      const latencyMs = Date.now() - startTime

      log.info(
        { callSid: call.sid, to: toPhone, latencyMs },
        'Voice call initiated'
      )

      return {
        success: true,
        providerMessageId: call.sid,
        providerStatusCode: call.status,
        deliveryConfidence: 'sent_no_confirmation',
        rawResponse: JSON.stringify({ sid: call.sid, status: call.status }),
        latencyMs,
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime
      const error = err instanceof Error ? err : new Error(String(err))
      const { errorCode, normalizedError } = mapTwilioError(error)
      log.error({ err, targetValue }, 'Voice provider send error')
      return {
        success: false,
        errorCode,
        normalizedError,
        rawResponse: error.message,
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
      capabilities: VOICE_CAPABILITIES,
      error: configured ? undefined : 'Twilio not configured — voice calls unavailable',
    }
  },

  getCapabilities(_config: Record<string, unknown>): NotificationCapabilities {
    return VOICE_CAPABILITIES
  },
}
