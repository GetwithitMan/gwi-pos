/**
 * android-update-rate-limit — tiny in-memory token bucket shared by the two
 * Android update proxy routes (/api/android/update/latest and
 * /api/android/update/events). One call per 30s per (deviceFingerprint, appKind)
 * tuple. Process-local only; resets on restart. Not durable and deliberately
 * simple — misuse is rate-limited at the edge, real policy lives in MC.
 */

const BUCKET_WINDOW_MS = 30_000
const SWEEP_EVERY_N = 100
const SWEEP_MAX_AGE_MS = 10 * 60 * 1000 // 10 min

// Map<"fingerprint:appKind", lastCallAtMs>
const lastCalls = new Map<string, number>()
let callsSinceSweep = 0

function sweep(nowMs: number): void {
  const cutoff = nowMs - SWEEP_MAX_AGE_MS
  for (const [key, at] of lastCalls) {
    if (at < cutoff) lastCalls.delete(key)
  }
}

function makeKey(deviceFingerprint: string, appKind: string): string {
  return `${deviceFingerprint}:${appKind}`
}

export function consumeBucket(
  deviceFingerprint: string,
  appKind: string,
):
  | { ok: true }
  | { ok: false; retryAfterSec: number } {
  const now = Date.now()

  // Opportunistic sweep — amortized O(1) per call.
  callsSinceSweep++
  if (callsSinceSweep >= SWEEP_EVERY_N) {
    callsSinceSweep = 0
    sweep(now)
  }

  const key = makeKey(deviceFingerprint, appKind)
  const last = lastCalls.get(key)
  if (last !== undefined) {
    const elapsed = now - last
    if (elapsed < BUCKET_WINDOW_MS) {
      const retryAfterSec = Math.max(1, Math.ceil((BUCKET_WINDOW_MS - elapsed) / 1000))
      return { ok: false, retryAfterSec }
    }
  }

  lastCalls.set(key, now)
  return { ok: true }
}

/** Exposed for tests — clears the module-level map. */
export function __resetRateLimitForTests(): void {
  lastCalls.clear()
  callsSinceSweep = 0
}
