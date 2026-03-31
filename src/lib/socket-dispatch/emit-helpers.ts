/**
 * Shared helpers and types for socket dispatch modules.
 *
 * Centralizes imports from socket-server, logger, and common types
 * so each domain dispatch file doesn't duplicate boilerplate.
 */

import crypto from 'crypto'
import { emitToLocation, emitToTags, emitToRoom, emitToTerminal, emitCriticalToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'

export const log = createChildLogger('socket-dispatch')

export { crypto, emitToLocation, emitToTags, emitToRoom, emitToTerminal, emitCriticalToLocation }

export interface DispatchOptions {
  /** Don't await the dispatch (fire and forget) */
  async?: boolean
}

/** Convert a dollar amount to cents (integer) */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}
