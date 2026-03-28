/**
 * Order-Ready Display Notification Provider
 *
 * Internal WebSocket/SSE display provider for order-ready screens.
 *
 * This provider does NOT make external HTTP calls. Instead, it emits socket
 * events to the location room via `emitToLocation()`.
 *
 * Socket event: `order-ready-display:update`
 * Payload: { action, orderNumber, customerName, fulfillmentMode, status }
 *
 * Event mapping:
 * - order_ready → action: 'add', status: 'ready'
 * - order_picked_up → action: 'remove'
 * - order_cancelled → action: 'remove'
 *
 * Features:
 * - Zod config validation
 * - executionZone: 'any' (purely internal)
 * - No external HTTP calls
 * - testConnection() always succeeds
 * - Capabilities: canDisplayPush only
 */

import { z } from 'zod'
import { createChildLogger } from '@/lib/logger'
import { emitToLocation } from '@/lib/socket-server'
import { NOTIFICATION_EVENTS } from '@/types/multi-surface'
import type {
  NotificationProvider,
  NotificationCapabilities,
  TestResult,
  ProviderType,
} from '../types'

const log = createChildLogger('display-provider')

// ─── Config Schema ──────────────────────────────────────────────────────────

const DisplayConfigSchema = z.object({
  screenGroupId: z.string().optional(),
  retentionMinutes: z.number().default(30),
  showCustomerName: z.boolean().default(true),
})

type DisplayConfig = z.infer<typeof DisplayConfigSchema>

// ─── Display Payload ────────────────────────────────────────────────────────

interface DisplayUpdatePayload {
  action: 'add' | 'remove'
  orderNumber?: number
  customerName?: string
  fulfillmentMode?: string
  status: 'preparing' | 'ready' | 'picked_up'
  screenGroupId?: string
  timestamp: string
}

// ─── Event → Action/Status Mapping ──────────────────────────────────────────

function mapEventToDisplayAction(eventType: string): { action: 'add' | 'remove'; status: 'preparing' | 'ready' | 'picked_up' } | null {
  switch (eventType) {
    case 'order_ready':
      return { action: 'add', status: 'ready' }
    case 'order_picked_up':
      return { action: 'remove', status: 'picked_up' }
    case 'order_cancelled':
      return { action: 'remove', status: 'picked_up' } // remove from display
    default:
      return null
  }
}

// ─── Capabilities ───────────────────────────────────────────────────────────

const DISPLAY_CAPABILITIES: NotificationCapabilities = {
  canPageNumeric: false,
  canPageAlpha: false,
  canSms: false,
  canVoice: false,
  canDisplayPush: true,
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

export const displayProvider: NotificationProvider = {
  type: 'display' as ProviderType,

  async send(params) {
    const { targetType, targetValue, message, config: rawConfig, metadata, providerId } = params
    const startTime = Date.now()

    // Validate config
    const parseResult = DisplayConfigSchema.safeParse(rawConfig)
    if (!parseResult.success) {
      return {
        success: false,
        errorCode: 'VALIDATION_ERROR',
        normalizedError: `Invalid display config: ${parseResult.error.message}`,
        latencyMs: 0,
      }
    }

    const config = parseResult.data

    // Extract context from metadata
    const locationId = metadata?.locationId as string
    const eventType = metadata?.eventType as string
    const orderNumber = metadata?.orderNumber as number | undefined
    const customerName = metadata?.customerName as string | undefined
    const fulfillmentMode = metadata?.fulfillmentMode as string | undefined

    if (!locationId) {
      return {
        success: false,
        errorCode: 'VALIDATION_ERROR',
        normalizedError: 'Display provider requires locationId in metadata',
        latencyMs: 0,
      }
    }

    // Map event type to display action
    const mapping = mapEventToDisplayAction(eventType)
    if (!mapping) {
      log.warn({ eventType }, 'Display provider: unsupported event type, skipping')
      return {
        success: true,
        providerStatusCode: 'skipped',
        deliveryConfidence: 'not_applicable',
        rawResponse: JSON.stringify({ skipped: true, reason: `Event type ${eventType} not mapped to display action` }),
        latencyMs: Date.now() - startTime,
      }
    }

    // Build the display payload
    const payload: DisplayUpdatePayload = {
      action: mapping.action,
      status: mapping.status,
      orderNumber,
      customerName: config.showCustomerName ? customerName : undefined,
      fulfillmentMode,
      screenGroupId: config.screenGroupId,
      timestamp: new Date().toISOString(),
    }

    try {
      // Emit to the location room via socket
      const emitted = await emitToLocation(
        locationId,
        NOTIFICATION_EVENTS.ORDER_READY_DISPLAY_UPDATE,
        payload
      )

      const latencyMs = Date.now() - startTime

      if (emitted) {
        log.info(
          { locationId, action: mapping.action, orderNumber },
          'Display provider: emitted order-ready-display:update'
        )
        return {
          success: true,
          providerStatusCode: '200',
          deliveryConfidence: 'sent_local',
          rawResponse: JSON.stringify(payload),
          latencyMs,
        }
      }

      // emitToLocation returns false if no sockets connected — not an error
      log.warn({ locationId }, 'Display provider: no connected clients in location room')
      return {
        success: true,
        providerStatusCode: 'no_clients',
        deliveryConfidence: 'sent_no_confirmation',
        rawResponse: JSON.stringify({ ...payload, note: 'No clients connected to location room' }),
        latencyMs,
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime
      log.error({ err, locationId }, 'Display provider: socket emit error')
      return {
        success: false,
        errorCode: 'NETWORK_ERROR',
        normalizedError: (err as Error).message,
        rawResponse: (err as Error).message,
        latencyMs,
      }
    }
  },

  async testConnection(_config: Record<string, unknown>): Promise<TestResult> {
    // Display provider is purely internal — always succeeds
    return {
      success: true,
      latencyMs: 0,
      capabilities: DISPLAY_CAPABILITIES,
      rawResponse: JSON.stringify({ internal: true, type: 'display' }),
    }
  },

  getCapabilities(_config: Record<string, unknown>): NotificationCapabilities {
    return DISPLAY_CAPABILITIES
  },
}
