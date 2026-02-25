/**
 * CAS PD-II Scale Protocol Implementation
 *
 * Implements the CAS PD-II "Type 5" serial protocol:
 * - Fixed serial: 9600 baud, 7 data bits, even parity, 1 stop bit
 * - Weight request: send 'W' (0x57)
 * - Tare command: send 'T' (0x54)
 * - Response: header byte, status byte, 5-digit weight, unit indicator, CR
 *
 * Status byte bit flags:
 *   bit 0-1: 00=stable, 01=unstable
 *   bit 2: overload
 *   bit 3: gross/net (0=gross, 1=net)
 */

import type { ScaleProtocol, WeightReading, SerialConfig } from './scale-protocol'

// Poll intervals
const ACTIVE_POLL_MS = 200
const IDLE_POLL_MS = 2000

// Reconnect backoff
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

export class CasPdIIProtocol implements ScaleProtocol {
  private port: import('serialport').SerialPort | null = null
  private parser: import('@serialport/parser-readline').ReadlineParser | null = null
  private config: SerialConfig
  private connected = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private active = false

  private weightCallbacks: Array<(reading: WeightReading) => void> = []
  private errorCallbacks: Array<(err: Error) => void> = []
  private disconnectCallbacks: Array<() => void> = []

  private pendingResolve: ((reading: WeightReading) => void) | null = null
  private pendingReject: ((err: Error) => void) | null = null

  constructor(config: SerialConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    if (this.connected) return

    const { SerialPort } = await import('serialport')
    const { ReadlineParser } = await import('@serialport/parser-readline')

    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path: this.config.portPath,
        baudRate: this.config.baudRate,
        dataBits: this.config.dataBits as 7 | 8 | 5 | 6,
        parity: this.config.parity,
        stopBits: this.config.stopBits as 1 | 1.5 | 2,
        autoOpen: false,
      })

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r' }))

      this.parser.on('data', (line: string) => {
        this.handleResponse(line)
      })

      this.port.on('error', (err: Error) => {
        this.emitError(err)
      })

      this.port.on('close', () => {
        this.connected = false
        this.stopPolling()
        this.emitDisconnect()
        this.scheduleReconnect()
      })

      this.port.open((err) => {
        if (err) {
          reject(err)
          return
        }
        this.connected = true
        this.reconnectAttempts = 0
        this.startPolling()
        resolve()
      })
    })
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    this.clearReconnect()

    if (this.port && this.port.isOpen) {
      return new Promise((resolve) => {
        this.port!.close(() => {
          this.connected = false
          this.port = null
          this.parser = null
          resolve()
        })
      })
    }

    this.connected = false
    this.port = null
    this.parser = null
  }

  async requestWeight(): Promise<WeightReading> {
    if (!this.connected || !this.port) {
      throw new Error('Scale not connected')
    }

    // Mark as active for faster polling
    this.active = true
    this.restartPolling()

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve
      this.pendingReject = reject

      this.sendCommand('W')

      // Timeout after 2 seconds
      setTimeout(() => {
        if (this.pendingReject) {
          this.pendingReject(new Error('Weight request timed out'))
          this.pendingResolve = null
          this.pendingReject = null
        }
      }, 2000)
    })
  }

  async tare(): Promise<void> {
    if (!this.connected || !this.port) {
      throw new Error('Scale not connected')
    }
    this.sendCommand('T')
  }

  isConnected(): boolean {
    return this.connected
  }

  onWeight(cb: (reading: WeightReading) => void): void {
    this.weightCallbacks.push(cb)
  }

  onError(cb: (err: Error) => void): void {
    this.errorCallbacks.push(cb)
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCallbacks.push(cb)
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private sendCommand(cmd: string): void {
    if (this.port && this.port.isOpen) {
      this.port.write(cmd)
    }
  }

  /**
   * Parse CAS PD-II Type 5 response
   *
   * Response format (variable by model, typical):
   *   Byte 0: Header (STX or status)
   *   Byte 1: Status flags
   *   Bytes 2-6: Weight digits (5 chars, right-justified, space-padded)
   *   Byte 7: Unit indicator
   *   Byte 8: CR (stripped by parser)
   *
   * Status byte flags:
   *   bit 0: 0=stable, 1=unstable
   *   bit 2: 1=overload
   *   bit 3: 0=gross, 1=net
   */
  private handleResponse(raw: string): void {
    try {
      const trimmed = raw.trim()
      if (trimmed.length < 7) return // Too short to be a valid response

      const statusByte = trimmed.charCodeAt(1)
      const stable = (statusByte & 0x01) === 0
      const overCapacity = (statusByte & 0x04) !== 0
      const isNet = (statusByte & 0x08) !== 0

      // Extract weight digits (5 chars starting at position 2)
      const weightStr = trimmed.substring(2, 7).trim()
      const rawWeight = parseInt(weightStr, 10)

      if (isNaN(rawWeight)) return

      // Apply precision: e.g., precision=2 → divide by 100
      const divisor = Math.pow(10, this.config.precision)
      const weight = rawWeight / divisor

      const reading: WeightReading = {
        weight,
        unit: this.config.weightUnit,
        stable,
        grossNet: isNet ? 'net' : 'gross',
        overCapacity,
        raw: trimmed,
        timestamp: new Date(),
      }

      // Resolve pending request if any
      if (this.pendingResolve) {
        this.pendingResolve(reading)
        this.pendingResolve = null
        this.pendingReject = null
      }

      // Emit to all weight callbacks
      for (const cb of this.weightCallbacks) {
        try {
          cb(reading)
        } catch {
          // Don't let one bad callback kill the pipeline
        }
      }
    } catch (err) {
      this.emitError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private startPolling(): void {
    this.stopPolling()
    const interval = this.active ? ACTIVE_POLL_MS : IDLE_POLL_MS
    this.pollTimer = setInterval(() => {
      if (this.connected) {
        this.sendCommand('W')
      }
    }, interval)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private restartPolling(): void {
    this.startPolling()

    // Return to idle polling after 10 seconds of inactivity
    setTimeout(() => {
      this.active = false
      if (this.connected) {
        this.startPolling()
      }
    }, 10000)
  }

  private scheduleReconnect(): void {
    this.clearReconnect()
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS
    )
    this.reconnectAttempts++

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect()
      } catch {
        // connect() failure will trigger close → scheduleReconnect again
      }
    }, delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private emitError(err: Error): void {
    for (const cb of this.errorCallbacks) {
      try {
        cb(err)
      } catch {
        // Swallow
      }
    }
  }

  private emitDisconnect(): void {
    for (const cb of this.disconnectCallbacks) {
      try {
        cb()
      } catch {
        // Swallow
      }
    }
  }
}
