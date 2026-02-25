/**
 * Scale Service — Singleton
 *
 * Manages all connected scales for this server instance.
 * Loads active scales from DB on startup, manages serial connections,
 * and dispatches weight readings + status changes via socket.
 */

import type { ScaleProtocol, WeightReading, SerialConfig } from './scale-protocol'
import { createScaleProtocol } from './scale-factory'
import { db } from '@/lib/db'
import { dispatchScaleWeight, dispatchScaleStatus } from '@/lib/socket-dispatch'

interface ManagedScale {
  id: string
  locationId: string
  name: string
  protocol: ScaleProtocol
  lastReading: WeightReading | null
}

class ScaleService {
  private scales = new Map<string, ManagedScale>()
  private initialized = false

  /**
   * Load active scales from DB and connect to each.
   * Called once at server startup.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    try {
      const activeScales = await db.scale.findMany({
        where: { isActive: true, deletedAt: null },
      })

      console.log(`[ScaleService] Found ${activeScales.length} active scale(s)`)

      for (const scale of activeScales) {
        void this.connectScale(scale).catch((err) => {
          console.error(`[ScaleService] Failed to connect scale "${scale.name}" (${scale.id}):`, err)
        })
      }
    } catch (err) {
      console.error('[ScaleService] Failed to load scales from DB:', err)
    }
  }

  /**
   * Get the latest weight reading for a scale.
   */
  getWeight(scaleId: string): WeightReading | null {
    return this.scales.get(scaleId)?.lastReading ?? null
  }

  /**
   * Send a tare command to a scale.
   */
  async tare(scaleId: string): Promise<void> {
    const managed = this.scales.get(scaleId)
    if (!managed) throw new Error(`Scale ${scaleId} not found`)
    if (!managed.protocol.isConnected()) throw new Error(`Scale ${scaleId} not connected`)
    await managed.protocol.tare()
  }

  /**
   * Request an on-demand weight reading.
   */
  async requestWeight(scaleId: string): Promise<WeightReading> {
    const managed = this.scales.get(scaleId)
    if (!managed) throw new Error(`Scale ${scaleId} not found`)
    if (!managed.protocol.isConnected()) throw new Error(`Scale ${scaleId} not connected`)
    return managed.protocol.requestWeight()
  }

  /**
   * Get connection status for a scale.
   */
  getStatus(scaleId: string): { connected: boolean; lastReading: WeightReading | null } | null {
    const managed = this.scales.get(scaleId)
    if (!managed) return null
    return {
      connected: managed.protocol.isConnected(),
      lastReading: managed.lastReading,
    }
  }

  /**
   * Add and connect a new scale at runtime (e.g., after admin creates one).
   */
  async addScale(scale: {
    id: string
    locationId: string
    name: string
    scaleType: string
    portPath: string
    baudRate: number
    dataBits: number
    parity: string
    stopBits: number
    weightUnit: string
    precision: number
  }): Promise<void> {
    // Disconnect existing if re-adding
    if (this.scales.has(scale.id)) {
      await this.removeScale(scale.id)
    }
    await this.connectScale(scale)
  }

  /**
   * Disconnect and remove a scale.
   */
  async removeScale(scaleId: string): Promise<void> {
    const managed = this.scales.get(scaleId)
    if (managed) {
      await managed.protocol.disconnect()
      this.scales.delete(scaleId)
    }
  }

  /**
   * Get all managed scale IDs.
   */
  getScaleIds(): string[] {
    return Array.from(this.scales.keys())
  }

  // ============================================================================
  // Private
  // ============================================================================

  private async connectScale(scale: {
    id: string
    locationId: string
    name: string
    scaleType: string
    portPath: string
    baudRate: number
    dataBits: number
    parity: string
    stopBits: number
    weightUnit: string
    precision: number
  }): Promise<void> {
    const config: SerialConfig = {
      portPath: scale.portPath,
      baudRate: scale.baudRate,
      dataBits: scale.dataBits,
      parity: scale.parity as 'none' | 'even' | 'odd',
      stopBits: scale.stopBits,
      weightUnit: scale.weightUnit,
      precision: scale.precision,
    }

    const protocol = createScaleProtocol(scale.scaleType, config)

    const managed: ManagedScale = {
      id: scale.id,
      locationId: scale.locationId,
      name: scale.name,
      protocol,
      lastReading: null,
    }

    // Wire up callbacks
    protocol.onWeight((reading) => {
      managed.lastReading = reading
      void dispatchScaleWeight(scale.locationId, scale.id, reading)
    })

    protocol.onError((err) => {
      console.error(`[ScaleService] Scale "${scale.name}" error:`, err.message)
      void this.updateScaleStatus(scale.id, false, err.message)
      void dispatchScaleStatus(scale.locationId, scale.id, {
        connected: false,
        error: err.message,
      })
    })

    protocol.onDisconnect(() => {
      console.warn(`[ScaleService] Scale "${scale.name}" disconnected`)
      void this.updateScaleStatus(scale.id, false, 'Disconnected')
      void dispatchScaleStatus(scale.locationId, scale.id, {
        connected: false,
        error: 'Disconnected',
      })
    })

    this.scales.set(scale.id, managed)

    // Attempt connection
    try {
      await protocol.connect()
      console.log(`[ScaleService] Scale "${scale.name}" connected on ${scale.portPath}`)
      void this.updateScaleStatus(scale.id, true, null)
      void dispatchScaleStatus(scale.locationId, scale.id, { connected: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ScaleService] Scale "${scale.name}" connect failed:`, msg)
      void this.updateScaleStatus(scale.id, false, msg)
      // Auto-reconnect is handled by the protocol implementation
    }
  }

  /**
   * Update scale connection status in DB (fire-and-forget).
   */
  private async updateScaleStatus(scaleId: string, connected: boolean, error: string | null): Promise<void> {
    try {
      await db.scale.update({
        where: { id: scaleId },
        data: {
          isConnected: connected,
          lastSeenAt: connected ? new Date() : undefined,
          lastError: error,
        },
      })
    } catch (err) {
      console.error(`[ScaleService] Failed to update scale status in DB:`, err)
    }
  }
}

export const scaleService = new ScaleService()
