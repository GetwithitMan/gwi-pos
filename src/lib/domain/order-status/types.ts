/**
 * Order Status Domain Types
 *
 * Single source of truth: derived from Prisma-generated enum to prevent
 * schema ↔ TypeScript drift. The Prisma schema defines the canonical set
 * of statuses; this file re-exports the type and adds semantic aliases.
 */

import { OrderStatus as PrismaOrderStatus } from '@/generated/prisma/enums'

// Re-export — any change to the Prisma enum automatically propagates here
export type OrderStatus = PrismaOrderStatus

// Semantic subsets for type narrowing
export type TerminalStatus = Extract<OrderStatus, 'paid' | 'closed' | 'voided' | 'cancelled' | 'completed' | 'merged'>
export type ActiveStatus = Extract<OrderStatus, 'draft' | 'open' | 'sent' | 'in_progress' | 'split'>

// Runtime set for validation at API boundaries
export { OrderStatus as OrderStatusEnum } from '@/generated/prisma/enums'

export interface TransitionResult {
  valid: boolean
  error?: string
  allowedNext?: OrderStatus[]
}
