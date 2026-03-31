/**
 * Socket Dispatch — barrel re-export
 *
 * All domain dispatch files are re-exported here so existing imports
 * from '@/lib/socket-dispatch' continue to work unchanged.
 */

export * from './order-dispatch'
export * from './payment-dispatch'
export * from './kds-dispatch'
export * from './tab-dispatch'
export * from './cfd-dispatch'
export * from './scale-dispatch'
export * from './sync-dispatch'
export * from './misc-dispatch'

// Re-export shared types for consumers that need them
export type { DispatchOptions } from './emit-helpers'
