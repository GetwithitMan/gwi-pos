#!/usr/bin/env ts-node
/**
 * Berg Bridge — RS-232 Serial Bridge for Berg ECU Hardware
 *
 * Standalone PM2 process. Opens one SerialPort per active BergDevice,
 * parses BB protocol packets using STX/ETX state machine, and POSTs
 * dispense events to /api/berg/dispense on the POS.
 *
 * Usage: node scripts/berg-bridge.js (compiled via ts-node or tsc)
 * PM2:   pm2 start ecosystem.config.js --only berg-bridge
 *
 * Environment:
 *   GWI_POS_URL       - POS base URL (default: http://localhost:3005)
 *   GWI_BRIDGE_SECRETS - JSON: { deviceId: plainSecret, ... }
 *                        Legacy secret source. Preferred: bridgeSecretEncrypted in DB
 *                        (decrypted with BRIDGE_MASTER_KEY). Bridge uses env var approach
 *                        since it doesn't have DB access; server accepts as legacy fallback.
 *   BERG_ENABLED      - Must be "true" to run
 */

import { SerialPort } from 'serialport'
import { createHash, createHmac } from 'crypto'
import { execSync } from 'child_process'

const POS_URL = process.env.GWI_POS_URL || 'http://localhost:3005'
const BERG_ENABLED = process.env.BERG_ENABLED === 'true'

if (!BERG_ENABLED) {
  console.log('[berg-bridge] BERG_ENABLED is not set to "true" — exiting')
  process.exit(0)
}

// ============================================================
// LRC helpers (inline — not importing from src/ to keep bridge
// standalone without Next.js module resolution)
// ============================================================

const STX = 0x02
const ETX = 0x03
const MAX_PACKET_BYTES = 256

function calculateLRC(buffer: Buffer): number {
  return buffer.reduce((lrc: number, byte: number) => lrc ^ byte, 0)
}

function byteToHex(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, '0')
}

function bufferToHex(buf: Buffer): string {
  return Array.from(buf).map(byteToHex).join('')
}

// ============================================================
// HMAC auth headers for bridge → POS auth (3-header format)
// ============================================================

function computeBridgeHeaders(deviceId: string, secret: string, bodyStr: string): Record<string, string> {
  const ts = String(Date.now())
  const bodySha256 = createHash('sha256').update(bodyStr).digest('hex')
  const message = `${deviceId}.${ts}.${bodySha256}`
  const sig = createHmac('sha256', secret).update(message).digest('hex')
  return {
    'x-berg-ts': ts,
    'x-berg-body-sha256': bodySha256,
    'Authorization': `Bearer ${sig}`,
  }
}

// ============================================================
// Packet parser state machine
// ============================================================

type ParserState = 'IDLE' | 'COLLECTING' | 'AWAIT_LRC'

interface ParsedPacket {
  rawPacket: string
  modifierBytes: string | null
  trailerBytes: string | null
  pluNumber: number | null
  lrcReceived: string
  lrcCalculated: string
  lrcValid: boolean
  parseStatus: string
}

function makeParser(onPacket: (p: ParsedPacket) => void, onError: (reason: string, ctx?: string) => void) {
  let state: ParserState = 'IDLE'
  let buffer: number[] = []

  return {
    feed(byte: number) {
      switch (state) {
        case 'IDLE':
          if (byte === STX) {
            buffer = [byte]
            state = 'COLLECTING'
          } else if (byte === ETX) {
            onError('NO_STX', `ETX before STX`)
          }
          break

        case 'COLLECTING':
          if (byte === STX) {
            // Reset on new STX (noise recovery)
            buffer = [byte]
            break
          }
          buffer.push(byte)
          if (byte === ETX) {
            state = 'AWAIT_LRC'
          } else if (buffer.length >= MAX_PACKET_BYTES) {
            onError('OVERFLOW', `Packet exceeded ${MAX_PACKET_BYTES} bytes`)
            buffer = []
            state = 'IDLE'
          }
          break

        case 'AWAIT_LRC': {
          const stxToEtxBuf = Buffer.from(buffer)
          const lrcCalculated = calculateLRC(stxToEtxBuf)
          const lrcValid = lrcCalculated === byte
          const rawPacket = bufferToHex(stxToEtxBuf)
          const lrcReceivedHex = byteToHex(byte)
          const lrcCalculatedHex = byteToHex(lrcCalculated)

          const dataBytes = buffer.slice(1, buffer.length - 1)
          let pluNumber: number | null = null
          let modifierBytes: string | null = null
          let trailerBytes: string | null = null
          let parseStatus = lrcValid ? 'OK' : 'BAD_LRC'

          if (lrcValid && dataBytes.length > 0) {
            if (dataBytes.some(b => b === 0x00 || b === STX || b === ETX)) {
              parseStatus = 'BAD_PACKET'
            } else {
              let i = 0
              const modBytes: number[] = []
              while (i < dataBytes.length && (dataBytes[i] < 0x30 || dataBytes[i] > 0x39)) {
                modBytes.push(dataBytes[i++])
              }
              const pluBytes: number[] = []
              while (i < dataBytes.length && dataBytes[i] >= 0x30 && dataBytes[i] <= 0x39) {
                pluBytes.push(dataBytes[i++])
              }
              const trailBytes = dataBytes.slice(i)
              if (pluBytes.length > 0) pluNumber = parseInt(pluBytes.map(b => String.fromCharCode(b)).join(''), 10)
              if (modBytes.length > 0) modifierBytes = bufferToHex(Buffer.from(modBytes))
              if (trailBytes.length > 0) trailerBytes = bufferToHex(Buffer.from(trailBytes))
            }
          }

          onPacket({ rawPacket, modifierBytes, trailerBytes, pluNumber, lrcReceived: lrcReceivedHex, lrcCalculated: lrcCalculatedHex, lrcValid, parseStatus })
          buffer = []
          state = 'IDLE'
          break
        }
      }
    },
  }
}

// ============================================================
// Device state
// ============================================================

interface DeviceConfig {
  id: string
  portName: string
  baudRate: number
  bridgeSecret: string | null
  ackTimeoutMs: number
}

interface ActiveDevice {
  config: DeviceConfig
  port: SerialPort | null
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

const activeDevices = new Map<string, ActiveDevice>()

// ============================================================
// HTTP helper — POST to POS with timeout
// ============================================================

async function postDispenseEvent(
  deviceConfig: DeviceConfig,
  packet: ParsedPacket,
  receivedAt: Date
): Promise<'ACK' | 'NAK'> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), deviceConfig.ackTimeoutMs + 2000)

  const bodyStr = JSON.stringify({
    deviceId: deviceConfig.id,
    pluNumber: packet.pluNumber,
    rawPacket: packet.rawPacket,
    modifierBytes: packet.modifierBytes,
    trailerBytes: packet.trailerBytes,
    lrcReceived: packet.lrcReceived,
    lrcCalculated: packet.lrcCalculated,
    lrcValid: packet.lrcValid,
    parseStatus: packet.parseStatus,
    receivedAt: receivedAt.toISOString(),
  })

  const authHeaders = deviceConfig.bridgeSecret
    ? computeBridgeHeaders(deviceConfig.id, deviceConfig.bridgeSecret, bodyStr)
    : {}

  try {
    const res = await fetch(`${POS_URL}/api/berg/dispense`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: bodyStr,
      signal: controller.signal,
    })
    const data = await res.json() as { action?: string }
    return data.action === 'NAK' ? 'NAK' : 'ACK'
  } catch (err: unknown) {
    const error = err as { name?: string }
    if (error?.name === 'AbortError') {
      console.error(`[berg-bridge][${deviceConfig.id}] POST timeout after ${deviceConfig.ackTimeoutMs}ms — ACK (best-effort)`)
    } else {
      console.error(`[berg-bridge][${deviceConfig.id}] POST failed:`, err)
    }
    return 'ACK' // Best-effort: never block the bar on a network error
  } finally {
    clearTimeout(timeout)
  }
}

// ============================================================
// Serial port management
// ============================================================

function sendByte(port: SerialPort | null, byte: number): void {
  if (!port?.isOpen) return
  port.write(Buffer.from([byte]), (err) => {
    if (err) console.error(`[berg-bridge] Write error:`, err.message)
  })
}

const ACK_BYTE = 0x06
const NAK_BYTE = 0x15

function openPort(deviceConfig: DeviceConfig): void {
  const active = activeDevices.get(deviceConfig.id)
  if (!active) return

  console.log(`[berg-bridge][${deviceConfig.id}] Opening port ${deviceConfig.portName} @ ${deviceConfig.baudRate} baud`)

  const port = new SerialPort({
    path: deviceConfig.portName,
    baudRate: deviceConfig.baudRate,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    autoOpen: true,
  })

  active.port = port
  active.reconnectAttempts = 0

  const parser = makeParser(
    async (packet) => {
      const receivedAt = new Date()
      console.log(`[berg-bridge][${deviceConfig.id}] Packet: PLU=${packet.pluNumber ?? 'null'} LRC=${packet.lrcValid ? 'OK' : 'FAIL'} raw=${packet.rawPacket}`)

      const action = await postDispenseEvent(deviceConfig, packet, receivedAt)
      sendByte(port, action === 'ACK' ? ACK_BYTE : NAK_BYTE)
      console.log(`[berg-bridge][${deviceConfig.id}] → ${action}`)
    },
    (reason, ctx) => {
      console.warn(`[berg-bridge][${deviceConfig.id}] Parse error: ${reason}${ctx ? ` (${ctx})` : ''}`)
    }
  )

  port.on('data', (chunk: Buffer) => {
    for (const byte of chunk) parser.feed(byte)
  })

  port.on('open', () => {
    console.log(`[berg-bridge][${deviceConfig.id}] Port open`)
    active.reconnectAttempts = 0
  })

  port.on('error', (err: Error) => {
    console.error(`[berg-bridge][${deviceConfig.id}] Port error: ${err.message}`)
    // Mark device error in POS (fire-and-forget)
    void fetch(`${POS_URL}/api/berg/devices/${deviceConfig.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastError: err.message }),
    }).catch(() => {})
  })

  port.on('close', () => {
    console.warn(`[berg-bridge][${deviceConfig.id}] Port closed — scheduling reconnect`)
    active.port = null
    scheduleReconnect(deviceConfig.id)
  })
}

function scheduleReconnect(deviceId: string): void {
  const active = activeDevices.get(deviceId)
  if (!active) return

  if (active.reconnectTimer) clearTimeout(active.reconnectTimer)

  // Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s max
  const delay = Math.min(1000 * Math.pow(2, active.reconnectAttempts), 30_000)
  active.reconnectAttempts++

  console.log(`[berg-bridge][${deviceId}] Reconnect in ${delay}ms (attempt ${active.reconnectAttempts})`)
  active.reconnectTimer = setTimeout(() => {
    openPort(active.config)
  }, delay)
}

// ============================================================
// Startup
// ============================================================

async function checkNtpSync(): Promise<void> {
  try {
    const status = execSync('timedatectl status 2>/dev/null', { timeout: 2000 }).toString()
    if (!status.includes('NTP synchronized: yes')) {
      console.warn('[berg-bridge] NTP not synchronized — attempting to enable: timedatectl set-ntp true')
      try {
        execSync('timedatectl set-ntp true 2>/dev/null', { timeout: 5000 })
        console.log('[berg-bridge] NTP sync enabled')
      } catch {
        console.warn('[berg-bridge] Could not enable NTP (may need sudo) — variance reports may be affected')
      }
    } else {
      console.log('[berg-bridge] NTP synchronized ✓')
    }
  } catch {
    // Not on Linux / timedatectl not available
  }
}

async function loadDevices(): Promise<DeviceConfig[]> {
  try {
    const res = await fetch(`${POS_URL}/api/berg/devices?locationId=all&active=true`)
    if (!res.ok) {
      console.error(`[berg-bridge] Failed to load devices: HTTP ${res.status}`)
      return []
    }
    const data = await res.json() as { devices?: Array<{ id: string; portName: string; baudRate: number; ackTimeoutMs: number }> }

    // Load bridge secrets from env
    const secretsEnv = process.env.GWI_BRIDGE_SECRETS
    const secrets: Record<string, string> = secretsEnv ? JSON.parse(secretsEnv) : {}

    return (data.devices || []).map(d => ({
      id: d.id,
      portName: d.portName,
      baudRate: d.baudRate || 9600,
      ackTimeoutMs: d.ackTimeoutMs || 3000,
      bridgeSecret: secrets[d.id] || null,
    }))
  } catch (err) {
    console.error('[berg-bridge] Could not load devices from POS:', err)
    return []
  }
}

async function main() {
  console.log(`[berg-bridge] Starting — POS: ${POS_URL}`)

  await checkNtpSync()

  const devices = await loadDevices()
  if (devices.length === 0) {
    console.warn('[berg-bridge] No active devices found — bridge will poll until devices are configured')
    // Poll every 30s for devices
    setTimeout(() => main().catch(console.error), 30_000)
    return
  }

  console.log(`[berg-bridge] Opening ${devices.length} device(s)`)
  for (const device of devices) {
    activeDevices.set(device.id, {
      config: device,
      port: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
    })
    try {
      openPort(device)
    } catch (err) {
      console.error(`[berg-bridge][${device.id}] Failed to open port ${device.portName}:`, err)
      scheduleReconnect(device.id)
    }
  }

  console.log('[berg-bridge] Running — Ctrl+C to stop')
}

main().catch(err => {
  console.error('[berg-bridge] Fatal startup error:', err)
  process.exit(1)
})
