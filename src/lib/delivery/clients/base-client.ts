// ---------------------------------------------------------------------------
// Base HTTP client infrastructure for third-party delivery platform APIs
// Provides: platformFetch (single request), withRetry (retry wrapper)
// ---------------------------------------------------------------------------

import type { GwiLogger } from '@/lib/logger'

// Lazy logger -- no module-scope side effects
let _log: GwiLogger | null = null
function log() {
  if (!_log) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _log = require('@/lib/logger').createChildLogger('delivery-client')
  }
  return _log!
}

// ---------------------------------------------------------------------------
// PlatformApiError
// ---------------------------------------------------------------------------

export class PlatformApiError extends Error {
  constructor(
    public platform: string,
    public statusCode: number,
    public responseBody: string,
    message: string,
  ) {
    super(message)
    this.name = 'PlatformApiError'
  }
}

// ---------------------------------------------------------------------------
// platformFetch — single HTTP call with timeout, JSON parsing, and logging
// ---------------------------------------------------------------------------

interface FetchOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export async function platformFetch(
  platform: string,
  opts: FetchOptions,
): Promise<{ status: number; data: unknown; headers: Headers }> {
  const { method, url, headers = {}, body, timeoutMs = 30_000 } = opts

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const fetchHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...headers,
    }

    const response = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const text = await response.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }

    if (!response.ok) {
      log().error(
        { platform, method, url, status: response.status, body: text.slice(0, 500) },
        `[${platform}] API error: ${response.status}`,
      )
      throw new PlatformApiError(
        platform,
        response.status,
        text,
        `${platform} API ${method} ${url} returned ${response.status}`,
      )
    }

    log().info(
      { platform, method, url: url.split('?')[0], status: response.status },
      `[${platform}] ${method} ${response.status}`,
    )

    return { status: response.status, data, headers: response.headers }
  } catch (error) {
    if (error instanceof PlatformApiError) throw error
    if ((error as Error).name === 'AbortError') {
      throw new PlatformApiError(
        platform,
        0,
        '',
        `${platform} API request timed out after ${timeoutMs}ms`,
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// withRetry — retry wrapper for transient (5xx / network) failures
// ---------------------------------------------------------------------------

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; platform: string; operation: string },
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      // Client errors (4xx) are not retryable
      if (error instanceof PlatformApiError && error.statusCode >= 400 && error.statusCode < 500) {
        throw error
      }
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10_000)
        log().warn(
          { platform: opts.platform, operation: opts.operation, attempt: attempt + 1, delay },
          `[${opts.platform}] Retrying ${opts.operation} in ${delay}ms`,
        )
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastError!
}
