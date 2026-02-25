/**
 * Prisma connection retry wrapper.
 *
 * Catches transient connection errors (P1001 — server unreachable,
 * P1008 — operation timed out) and retries up to 2 times with
 * exponential backoff (500ms, 1000ms).
 */

const RETRYABLE_CODES = new Set(['P1001', 'P1008'])
const MAX_RETRIES = 2
const BASE_DELAY_MS = 500

function isPrismaRetryable(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return RETRYABLE_CODES.has((error as { code: string }).code)
  }
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function withPrismaRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRIES && isPrismaRetryable(error)) {
        const waitMs = BASE_DELAY_MS * Math.pow(2, attempt)
        console.warn(
          `[prisma-retry] Transient error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${waitMs}ms`,
          (error as { code?: string }).code,
        )
        await delay(waitMs)
        continue
      }
      throw error
    }
  }
  throw lastError
}
