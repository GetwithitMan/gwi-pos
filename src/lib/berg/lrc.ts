/**
 * Berg Basic (BB) Protocol — LRC Calculator
 *
 * Per Berg spec: XOR over bytes from STX (0x02) through ETX (0x03), inclusive.
 * The received LRC byte comes immediately after ETX and is NOT included in the XOR.
 *
 * buffer = [0x02(STX), ...data bytes..., 0x03(ETX)]  ← exactly this range
 * receivedLRC = the next byte after ETX
 *
 * Usage:
 *   const calculated = calculateLRC(stxToEtxBuffer)
 *   if (calculated !== receivedLrcByte) → BAD_LRC → NAK
 */

/**
 * XOR all bytes in the buffer (should span STX through ETX inclusive).
 */
export function calculateLRC(buffer: Buffer): number {
  return buffer.reduce((lrc: number, byte: number) => lrc ^ byte, 0)
}

/**
 * Validate a received LRC byte against a buffer (STX through ETX).
 */
export function validateLRC(buffer: Buffer, receivedLRC: number): boolean {
  return calculateLRC(buffer) === receivedLRC
}

/**
 * Format a byte as uppercase hex string (e.g., 0x2A → "2A").
 */
export function byteToHex(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, '0')
}

/**
 * Format a Buffer as a hex string (e.g., Buffer([0x02, 0x31]) → "0231").
 */
export function bufferToHex(buf: Buffer): string {
  return Array.from(buf).map(byteToHex).join('')
}
