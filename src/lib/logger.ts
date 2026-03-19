/**
 * Structured logger (pino-based)
 *
 * - JSON output in production (for log aggregators)
 * - Pretty-printed, colorized output in development
 * - Child loggers for workers and per-request trace IDs
 *
 * Backwards compatible with the old console-wrapper logger:
 *   logger.log('message')               → works (alias for .info)
 *   logger.warn('category', 'message')  → works (legacy variadic)
 *   logger.error('cat', 'msg', err, {}) → works (legacy variadic)
 *
 * New structured usage (preferred):
 *   logger.info({ orderId }, 'Order created')
 *   logger.error({ err }, 'Payment failed')
 *
 * Child loggers:
 *   import { createChildLogger, withRequestId } from '@/lib/logger'
 *   const log = createChildLogger('upstreamSync')
 *   const reqLog = withRequestId(requestId)
 */

import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

const _pino = pino({
  level: isProduction ? 'info' : 'debug',
  transport: isProduction ? undefined : { target: 'pino-pretty', options: { colorize: true } },
})

/** Logger interface that includes the .log() alias and accepts variadic args */
export interface GwiLogger {
  fatal: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  trace: (...args: unknown[]) => void
  /** Alias for .info() — backwards compatibility with old console-wrapper logger */
  log: (...args: unknown[]) => void
  /** Create a child logger with additional context fields */
  child: (bindings: Record<string, unknown>) => GwiLogger
}

function wrapPino(instance: pino.Logger): GwiLogger {
  const wrapped: GwiLogger = {
    fatal: wrapLevelFor(instance, instance.fatal),
    error: wrapLevelFor(instance, instance.error),
    warn: wrapLevelFor(instance, instance.warn),
    info: wrapLevelFor(instance, instance.info),
    debug: wrapLevelFor(instance, instance.debug),
    trace: wrapLevelFor(instance, instance.trace),
    log: wrapLevelFor(instance, instance.info), // alias
    child(bindings: Record<string, unknown>) {
      return wrapPino(instance.child(bindings))
    },
  }
  return wrapped
}

function wrapLevelFor(instance: pino.Logger, fn: pino.LogFn): (...args: unknown[]) => void {
  return function wrappedLog(...args: unknown[]) {
    // Legacy variadic: (category: string, message: string, ...extras)
    if (args.length >= 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
      const category = args[0] as string
      const message = args[1] as string
      const extras: Record<string, unknown> = { category }
      for (let i = 2; i < args.length; i++) {
        const arg = args[i]
        if (arg instanceof Error) {
          extras.err = arg
        } else if (arg && typeof arg === 'object') {
          Object.assign(extras, arg)
        }
      }
      fn.call(instance, extras, message)
      return
    }
    // Standard pino call: (msg), (obj, msg), (obj, msg, ...args)
    ;(fn as (...args: unknown[]) => unknown).apply(instance, args)
  }
}

export const logger: GwiLogger = wrapPino(_pino)

/** Create a child logger with a fixed name field (for workers, sync cycles, etc.) */
export function createChildLogger(name: string): GwiLogger {
  return wrapPino(_pino.child({ worker: name }))
}

/** Create a child logger with a request ID (for HTTP request context) */
export function withRequestId(requestId: string): GwiLogger {
  return wrapPino(_pino.child({ requestId }))
}
