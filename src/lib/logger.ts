/**
 * Development-only logger utility
 * All logs are stripped in production builds for performance
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.warn('Invalid coordinate:', value)  // Silent in production
 *   logger.error('Critical error:', error)     // Always logged
 */

const isDev = process.env.NODE_ENV !== 'production'

export const logger = {
  /**
   * Development-only warning logs
   * Silent in production
   */
  warn: (...args: any[]) => {
    if (isDev) {
      console.warn(...args)
    }
  },

  /**
   * Development-only info logs
   * Silent in production
   */
  log: (...args: any[]) => {
    if (isDev) {
      console.log(...args)
    }
  },

  /**
   * Error logs (always logged, even in production)
   * Use for errors that need observability
   */
  error: (...args: any[]) => {
    console.error(...args)
  },

  /**
   * Development-only debug logs
   * Silent in production
   */
  debug: (...args: any[]) => {
    if (isDev) {
      console.debug(...args)
    }
  }
}
