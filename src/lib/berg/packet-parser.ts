/**
 * Berg Basic (BB) Protocol — Packet Parser State Machine
 *
 * Berg ECUs communicate via RS-232 at 9600 baud 8/N/1 using STX/ETX framing.
 * DO NOT use readline parser — packets are binary-framed, not newline-delimited.
 *
 * State transitions:
 *   IDLE → (receive STX 0x02) → COLLECTING
 *   COLLECTING → (receive ETX 0x03) → AWAIT_LRC
 *   COLLECTING → (buffer full 256 bytes) → OVERFLOW → IDLE
 *   AWAIT_LRC → (receive LRC byte) → VALIDATE → callback → IDLE
 *
 * Non-ASCII-digit bytes in PLU position are preserved as modifierBytes.
 * NULL / STX / ETX bytes in modifier/trailer fields trigger BAD_PACKET.
 */

import { calculateLRC, byteToHex, bufferToHex } from './lrc'

const STX = 0x02
const ETX = 0x03
const MAX_PACKET_BYTES = 256 // reset + OVERFLOW on exceed

export type BergParseStatus =
  | 'OK'
  | 'BAD_LRC'
  | 'BAD_PACKET'
  | 'NO_STX'
  | 'OVERFLOW'
  | 'UNMAPPED_PLU'

export interface ParsedPacket {
  /** STX through ETX inclusive, as hex string */
  rawPacket: string
  /** Modifier bytes before PLU digits (hex), if any */
  modifierBytes: string | null
  /** Trailer bytes after PLU digits (hex), if any */
  trailerBytes: string | null
  /** Parsed PLU number (from ASCII digit bytes in data field) */
  pluNumber: number | null
  /** LRC byte as received (hex) */
  lrcReceived: string
  /** LRC byte we calculated (hex) */
  lrcCalculated: string
  /** Whether LRC check passed */
  lrcValid: boolean
  /** Parse outcome */
  parseStatus: BergParseStatus
}

export interface PacketParserCallbacks {
  onPacket: (packet: ParsedPacket) => void
  onError?: (reason: BergParseStatus, context?: string) => void
}

type ParserState = 'IDLE' | 'COLLECTING' | 'AWAIT_LRC'

export class BergPacketParser {
  private state: ParserState = 'IDLE'
  private buffer: number[] = []
  private readonly callbacks: PacketParserCallbacks

  constructor(callbacks: PacketParserCallbacks) {
    this.callbacks = callbacks
  }

  /**
   * Feed a single byte into the state machine.
   * Call this for each byte from port.on('data', chunk => { for (const byte of chunk) parser.feed(byte) })
   */
  feed(byte: number): void {
    switch (this.state) {
      case 'IDLE':
        if (byte === STX) {
          this.buffer = [byte]
          this.state = 'COLLECTING'
        } else if (byte === ETX) {
          // ETX without STX
          this.callbacks.onError?.('NO_STX', `ETX received before STX (byte: ${byteToHex(byte)})`)
        }
        // Other bytes in IDLE = noise, ignore
        break

      case 'COLLECTING':
        if (byte === STX) {
          // New STX while collecting — treat as reset (Berg won't do this, but handle noise)
          this.buffer = [byte]
          break
        }
        this.buffer.push(byte)
        if (byte === ETX) {
          this.state = 'AWAIT_LRC'
        } else if (this.buffer.length >= MAX_PACKET_BYTES) {
          this.callbacks.onError?.('OVERFLOW', `Packet exceeded ${MAX_PACKET_BYTES} bytes`)
          this.reset()
        }
        break

      case 'AWAIT_LRC': {
        const stxToEtxBuf = Buffer.from(this.buffer)
        const lrcCalculated = calculateLRC(stxToEtxBuf)
        const lrcValid = lrcCalculated === byte

        const rawPacket = bufferToHex(stxToEtxBuf)
        const lrcReceivedHex = byteToHex(byte)
        const lrcCalculatedHex = byteToHex(lrcCalculated)

        // Data bytes: everything between STX and ETX (exclusive)
        const dataBytes = this.buffer.slice(1, this.buffer.length - 1)

        let pluNumber: number | null = null
        let modifierBytes: string | null = null
        let trailerBytes: string | null = null
        let parseStatus: BergParseStatus = lrcValid ? 'OK' : 'BAD_LRC'

        if (lrcValid && dataBytes.length > 0) {
          // Check for BAD_PACKET: NULL/STX/ETX inside data
          if (dataBytes.some(b => b === 0x00 || b === STX || b === ETX)) {
            parseStatus = 'BAD_PACKET'
          } else {
            // Split data into: modifier bytes (non-digit prefix) + PLU digits + trailer bytes
            let i = 0
            const modBytes: number[] = []
            while (i < dataBytes.length && (dataBytes[i] < 0x30 || dataBytes[i] > 0x39)) {
              modBytes.push(dataBytes[i])
              i++
            }
            const pluBytes: number[] = []
            while (i < dataBytes.length && dataBytes[i] >= 0x30 && dataBytes[i] <= 0x39) {
              pluBytes.push(dataBytes[i])
              i++
            }
            const trailBytes = dataBytes.slice(i)

            if (pluBytes.length > 0) {
              pluNumber = parseInt(pluBytes.map(b => String.fromCharCode(b)).join(''), 10)
            }
            if (modBytes.length > 0) modifierBytes = bufferToHex(Buffer.from(modBytes))
            if (trailBytes.length > 0) trailerBytes = bufferToHex(Buffer.from(trailBytes))
          }
        }

        this.callbacks.onPacket({
          rawPacket,
          modifierBytes,
          trailerBytes,
          pluNumber,
          lrcReceived: lrcReceivedHex,
          lrcCalculated: lrcCalculatedHex,
          lrcValid,
          parseStatus,
        })

        this.reset()
        break
      }
    }
  }

  private reset(): void {
    this.state = 'IDLE'
    this.buffer = []
  }
}
