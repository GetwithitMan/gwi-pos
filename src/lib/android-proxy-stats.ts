/**
 * Android proxy health counters — best-effort, process-local telemetry for the
 * NUC's `/api/android/update/*` proxy routes. Tracks a sliding 5-minute count
 * of forwarded events and cache serves, plus the last forward error (if any).
 * Values reset on process restart; this module intentionally avoids persistence
 * and external dependencies. Safe for repeated imports (singleton state).
 */

// ─── Internal state (module singleton) ────────────────────────────────────

interface TimedSample {
  at: number      // epoch ms
  count: number   // eventCount contribution
}

interface LastError {
  message: string
  status: number | null
  at: string      // ISO-8601
}

const WINDOW_MS = 5 * 60 * 1000
const MAX_SAMPLES = 10_000
const MAX_MESSAGE_LEN = 512

const forwardSamples: TimedSample[] = []
const cacheServeSamples: TimedSample[] = []
let lastError: LastError | null = null

// ─── Helpers ──────────────────────────────────────────────────────────────

function prune(samples: TimedSample[], nowMs: number): void {
  const cutoff = nowMs - WINDOW_MS
  // Drop expired entries from the front (samples are inserted chronologically).
  while (samples.length > 0 && samples[0].at < cutoff) {
    samples.shift()
  }
  // Enforce hard cap — drop oldest when over.
  while (samples.length > MAX_SAMPLES) {
    samples.shift()
  }
}

function sumInWindow(samples: TimedSample[], nowMs: number): number {
  const cutoff = nowMs - WINDOW_MS
  let total = 0
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]
    if (s.at < cutoff) break
    total += s.count
  }
  return total
}

// ─── Public API ───────────────────────────────────────────────────────────

/** Call each time a batch is forwarded to MC. Bumps the 5m sliding counter. */
export function recordForward(eventCount: number): void {
  if (!Number.isFinite(eventCount) || eventCount <= 0) return
  const now = Date.now()
  forwardSamples.push({ at: now, count: Math.floor(eventCount) })
  prune(forwardSamples, now)
}

/** Call on any forward failure (non-2xx / timeout / network error). */
export function recordForwardError(message: string, status?: number): void {
  const safeMessage = (message ?? '').toString().slice(0, MAX_MESSAGE_LEN)
  lastError = {
    message: safeMessage,
    status: typeof status === 'number' && Number.isFinite(status) ? status : null,
    at: new Date().toISOString(),
  }
}

/** Call when the per-(appKind,channel) cache serves a response. */
export function recordCacheServe(): void {
  const now = Date.now()
  cacheServeSamples.push({ at: now, count: 1 })
  prune(cacheServeSamples, now)
}

/** Snapshot for the heartbeat internal endpoint. Cheap to call. */
export function getAndroidProxyStats(): {
  androidProxyForwarded5m: number
  androidProxyLastError: {
    message: string
    status: number | null
    at: string
  } | null
  androidProxyCacheServes5m: number
  generatedAt: string
} {
  const now = Date.now()
  prune(forwardSamples, now)
  prune(cacheServeSamples, now)
  return {
    androidProxyForwarded5m: sumInWindow(forwardSamples, now),
    androidProxyLastError: lastError,
    androidProxyCacheServes5m: sumInWindow(cacheServeSamples, now),
    generatedAt: new Date(now).toISOString(),
  }
}
