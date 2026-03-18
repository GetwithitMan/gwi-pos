/**
 * Structured logger (pino-based)
 *
 * - JSON output in production (for log aggregators)
 * - Pretty-printed, colorized output in development
 * - Child loggers for workers and per-request trace IDs
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.info('Order created', { orderId })
 *   logger.warn('Invalid coordinate', { value })
 *   logger.error('Critical error', { err })
 *
 * Child loggers:
 *   import { createChildLogger, withRequestId } from '@/lib/logger'
 *   const log = createChildLogger('upstreamSync')
 *   const reqLog = withRequestId(requestId)
 */

import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

const logger = pino({
  level: isProduction ? 'info' : 'debug',
  transport: isProduction ? undefined : { target: 'pino-pretty', options: { colorize: true } },
})

// Alias .log to .info for backwards compatibility with existing code
// (the old logger used .log() extensively; pino uses .info() instead)
;(logger as any).log = logger.info.bind(logger)

export { logger }

/** Create a child logger with a fixed name field (for workers, sync cycles, etc.) */
export function createChildLogger(name: string) {
  const child = logger.child({ worker: name })
  // Propagate .log alias to child loggers
  ;(child as any).log = child.info.bind(child)
  return child
}

/** Create a child logger with a request ID (for HTTP request context) */
export function withRequestId(requestId: string) {
  const child = logger.child({ requestId })
  ;(child as any).log = child.info.bind(child)
  return child
}
