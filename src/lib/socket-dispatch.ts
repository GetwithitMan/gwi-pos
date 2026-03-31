/**
 * Socket Event Dispatcher — BACKWARD COMPATIBLE re-export
 *
 * This file has been split into focused domain-specific modules under
 * src/lib/socket-dispatch/. All exports are re-exported here so that
 * existing imports from '@/lib/socket-dispatch' continue to work.
 *
 * Domain files:
 *   order-dispatch.ts      — orders, items, splits, summaries, claims
 *   payment-dispatch.ts    — payments, tips, gift cards, card detection
 *   kds-dispatch.ts        — KDS item status, bumps, forwarding
 *   tab-dispatch.ts        — tabs, mobile tab events
 *   cfd-dispatch.ts        — customer-facing display events
 *   scale-dispatch.ts      — weight scale readings and status
 *   sync-dispatch.ts       — outage status, HA failover
 *   misc-dispatch.ts       — entertainment, inventory, menu, alerts, etc.
 *   emit-helpers.ts        — shared logger, emit wrappers, types
 */

export * from './socket-dispatch/order-dispatch'
export * from './socket-dispatch/payment-dispatch'
export * from './socket-dispatch/kds-dispatch'
export * from './socket-dispatch/tab-dispatch'
export * from './socket-dispatch/cfd-dispatch'
export * from './socket-dispatch/scale-dispatch'
export * from './socket-dispatch/sync-dispatch'
export * from './socket-dispatch/misc-dispatch'

// Re-export shared types for consumers that need them
export type { DispatchOptions } from './socket-dispatch/emit-helpers'
