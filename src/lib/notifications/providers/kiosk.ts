/**
 * Kiosk Dispenser Stub Provider (JTECH NextUp)
 *
 * Stub implementation for kiosk pager dispensing hardware.
 * The key method is assignDevice() — dispenses a physical pager
 * from a kiosk unit and returns the assigned device number.
 *
 * Not fully functional yet; interface is ready for future hardware integration.
 *
 * Capabilities: { canKioskDispense: true, canDeviceAssignment: true }
 * executionZone: 'local_nuc' (kiosk is physical hardware on local network)
 */

import { z } from 'zod'
import { createChildLogger } from '@/lib/logger'
import type {
  NotificationProvider,
  NotificationCapabilities,
  TestResult,
  ProviderType,
} from '../types'

const log = createChildLogger('kiosk-provider')

// ─── Config Schema ──────────────────────────────────────────────────────────

export const KioskConfigSchema = z.object({
  kioskId: z.string(),
  apiEndpoint: z.string().url().optional(),
  autoAssignOnOrder: z.boolean().default(false),
})

export type KioskConfig = z.infer<typeof KioskConfigSchema>

// ─── Capabilities ───────────────────────────────────────────────────────────

const KIOSK_CAPABILITIES: NotificationCapabilities = {
  canPageNumeric: false,
  canPageAlpha: false,
  canSms: false,
  canVoice: false,
  canDisplayPush: false,
  canDeviceInventory: false,
  canDeviceAssignment: true,
  canDeviceRecall: false,
  canOutOfRangeDetection: false,
  canBatteryTelemetry: false,
  canTracking: false,
  canKioskDispense: true,
  canCancellation: false,
  canDeliveryConfirmation: false,
}

// ─── Provider Implementation ────────────────────────────────────────────────

export const kioskProvider: NotificationProvider = {
  type: 'kiosk' as ProviderType,

  async send(params) {
    const startTime = Date.now()

    // Stub: kiosk dispenser does not send notifications — it dispenses physical pagers.
    // Actual notification delivery is handled by the pager itself (JTECH/LRS).
    log.warn(
      { targetType: params.targetType, targetValue: params.targetValue },
      'Kiosk dispense not yet implemented — stub returning success'
    )

    return {
      success: true,
      providerMessageId: `kiosk-stub-${Date.now()}`,
      providerStatusCode: 'stub',
      deliveryConfidence: 'simulated',
      rawResponse: JSON.stringify({
        stub: true,
        message: 'Kiosk dispense not yet implemented',
      }),
      latencyMs: Date.now() - startTime,
    }
  },

  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    const startTime = Date.now()

    // Validate config shape
    const parseResult = KioskConfigSchema.safeParse(config)
    if (!parseResult.success) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        capabilities: KIOSK_CAPABILITIES,
        error: `Invalid kiosk config: ${parseResult.error.message}`,
      }
    }

    const parsed = parseResult.data

    // If an API endpoint is configured, we would test connectivity here.
    // For now, return stub success.
    if (parsed.apiEndpoint) {
      log.info({ kioskId: parsed.kioskId, apiEndpoint: parsed.apiEndpoint }, 'Kiosk test connection — stub (endpoint configured but not tested)')
    }

    return {
      success: true,
      latencyMs: Date.now() - startTime,
      capabilities: KIOSK_CAPABILITIES,
      rawResponse: JSON.stringify({
        stub: true,
        kioskId: parsed.kioskId,
        hasEndpoint: !!parsed.apiEndpoint,
      }),
    }
  },

  getCapabilities(_config: Record<string, unknown>): NotificationCapabilities {
    return KIOSK_CAPABILITIES
  },
}

// ─── Device Assignment (Key Method) ─────────────────────────────────────────

/**
 * Dispense a pager from the kiosk unit.
 *
 * In production, this would call the JTECH NextUp kiosk API to physically
 * dispense a pager and return the assigned device number.
 *
 * For now: returns a stub device number with a warning log.
 *
 * @param config - Kiosk configuration
 * @param subjectType - 'order' | 'waitlist_entry'
 * @param subjectId - The subject ID to assign the pager to
 * @returns The dispensed device number, or null if dispensing failed
 */
export async function assignDeviceFromKiosk(
  config: Record<string, unknown>,
  subjectType: string,
  subjectId: string
): Promise<{
  success: boolean
  deviceNumber: string | null
  error?: string
}> {
  const parseResult = KioskConfigSchema.safeParse(config)
  if (!parseResult.success) {
    return {
      success: false,
      deviceNumber: null,
      error: `Invalid kiosk config: ${parseResult.error.message}`,
    }
  }

  const parsed = parseResult.data

  // Stub: generate a random device number
  // In production, this calls `POST ${parsed.apiEndpoint}/dispense`
  // and the kiosk physically ejects a pager, returning its number
  const stubDeviceNumber = String(Math.floor(100 + Math.random() * 900))

  log.warn(
    {
      kioskId: parsed.kioskId,
      subjectType,
      subjectId,
      stubDeviceNumber,
    },
    'Kiosk assignDevice — STUB: returning random device number (hardware not integrated)'
  )

  return {
    success: true,
    deviceNumber: stubDeviceNumber,
  }
}
