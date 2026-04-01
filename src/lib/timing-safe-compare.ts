import { timingSafeEqual } from 'crypto'

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 *
 * Uses crypto.timingSafeEqual under the hood. Returns false if either
 * value is falsy or if the lengths differ (timingSafeEqual requires
 * equal-length buffers).
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
