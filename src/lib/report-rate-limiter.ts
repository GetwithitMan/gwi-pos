// Simple in-memory rate limiter for expensive report queries
// 2 requests per employee per 30 seconds
const REPORT_MAX_REQUESTS = 2
const REPORT_WINDOW_MS = 30_000

const reportRateMap = new Map<string, { count: number; windowStart: number }>()

export function checkReportRateLimit(employeeId: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now()
  const entry = reportRateMap.get(employeeId)
  if (!entry || now - entry.windowStart > REPORT_WINDOW_MS) {
    reportRateMap.set(employeeId, { count: 1, windowStart: now })
    return { allowed: true }
  }
  if (entry.count >= REPORT_MAX_REQUESTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.windowStart + REPORT_WINDOW_MS - now) / 1000) }
  }
  entry.count++
  return { allowed: true }
}

// Cleanup stale entries every 60s
const cleanup = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of reportRateMap) {
    if (now - entry.windowStart > REPORT_WINDOW_MS) reportRateMap.delete(key)
  }
}, 60_000)
if (cleanup && typeof cleanup === 'object' && 'unref' in cleanup) cleanup.unref()
