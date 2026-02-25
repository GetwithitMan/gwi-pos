/**
 * Server-side file validation via magic bytes.
 *
 * Validates actual file content (not just the Content-Type header, which
 * can be spoofed). Checks the first few bytes of the file against known
 * file signatures.
 */

interface MagicSignature {
  bytes: number[]
  offset?: number // default 0
}

const SIGNATURES: Record<string, MagicSignature[]> = {
  'image/jpeg': [
    { bytes: [0xFF, 0xD8, 0xFF] },
  ],
  'image/png': [
    { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  ],
  'image/gif': [
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  'image/webp': [
    // RIFF....WEBP
    { bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" at offset 0
    // bytes 8-11 = "WEBP" checked separately
  ],
  'application/pdf': [
    { bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ],
}

/**
 * Validate that a buffer's magic bytes match the claimed MIME type.
 *
 * @param buffer - The file content (at least first 12 bytes)
 * @param claimedType - The MIME type from Content-Type / file.type
 * @returns true if magic bytes match the claimed type
 */
export function validateMagicBytes(buffer: Buffer | Uint8Array, claimedType: string): boolean {
  if (buffer.length < 4) return false

  const signatures = SIGNATURES[claimedType]
  if (!signatures) {
    // No signature defined for this type — skip validation (allow)
    return true
  }

  // Special case for WebP: check RIFF header AND "WEBP" at offset 8
  if (claimedType === 'image/webp') {
    if (buffer.length < 12) return false
    const isRiff = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    return isRiff && isWebp
  }

  return signatures.some(sig => {
    const offset = sig.offset ?? 0
    if (buffer.length < offset + sig.bytes.length) return false
    return sig.bytes.every((byte, i) => buffer[offset + i] === byte)
  })
}

/**
 * Detect the actual MIME type of a buffer from its magic bytes.
 * Returns null if the type cannot be determined.
 */
export function detectMimeType(buffer: Buffer | Uint8Array): string | null {
  if (buffer.length < 4) return null

  // Check WebP first (needs special RIFF+WEBP check)
  if (buffer.length >= 12) {
    const isRiff = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    if (isRiff && isWebp) return 'image/webp'
  }

  for (const [mimeType, signatures] of Object.entries(SIGNATURES)) {
    if (mimeType === 'image/webp') continue // handled above
    const match = signatures.some(sig => {
      const offset = sig.offset ?? 0
      if (buffer.length < offset + sig.bytes.length) return false
      return sig.bytes.every((byte, i) => buffer[offset + i] === byte)
    })
    if (match) return mimeType
  }

  return null
}
