/**
 * KDS Overhaul — Typed contracts + Zod schemas
 *
 * Single source of truth for all KDS JSON field shapes, link types,
 * bump actions, socket payloads, and validation schemas.
 */

import { z } from 'zod'

// ── Enums / Literal Unions ──

export type KDSDisplayMode = 'tiled' | 'classic' | 'split' | 'takeout'
export type KDSLinkType = 'send_to_next' | 'multi_clear'
export type KDSBumpAction = 'bump' | 'strike_through' | 'no_action'

// ── JSON Field Interfaces ──

export interface KDSTransitionTimes {
  [orderType: string]: { caution: number; late: number }
}

export interface KDSOrderBehavior {
  tapToStart: boolean
  mergeCards: boolean
  mergeWindowMinutes: number
  newCardPerSend: boolean
  moveCompletedToBottom: boolean
  strikeThroughModifiers: boolean
  resetTimerOnRecall: boolean
  intelligentSort: boolean
  showAllDayCounts: boolean
  allDayCountResetHour: number
  orderTrackerEnabled: boolean
  sendSmsOnReady: boolean
  printOnBump: boolean
  printerId: string | null
  /** Auto-expire orders older than this many minutes from KDS display.
   *  0 = disabled (no auto-expiry). Default: 300 (5 hours). */
  autoExpireMinutes: number
}

export interface KDSOrderTypeFilters {
  [orderType: string]: boolean
}

// ── Screen Link ──

export interface KDSScreenLinkData {
  id: string
  locationId: string
  sourceScreenId: string
  targetScreenId: string
  linkType: KDSLinkType
  bumpAction: KDSBumpAction
  resetStrikethroughsOnSend: boolean
  isActive: boolean
  sortOrder: number
  targetScreenName?: string
}

// ── Socket Event Payloads ──

export interface KDSOrderForwardedPayload {
  eventId: string
  orderId: string
  itemIds: string[]
  targetScreenId: string
  sourceScreenId: string
  linkType: KDSLinkType
  bumpAction: KDSBumpAction
  resetStrikethroughs: boolean
  bumpedBy: string
  locationId: string
  timestamp: string
}

export interface KDSMultiClearPayload {
  eventId: string
  orderId: string
  itemIds: string[]
  targetScreenId: string
  sourceScreenId: string
  bumpAction: KDSBumpAction
  locationId: string
  timestamp: string
}

// ── Zod Schemas (server-side validation) ──

export const KDSDisplayModeSchema = z.enum(['tiled', 'classic', 'split', 'takeout'])

export const KDSLinkTypeSchema = z.enum(['send_to_next', 'multi_clear'])

export const KDSBumpActionSchema = z.enum(['bump', 'strike_through', 'no_action'])

export const KDSTransitionTimesSchema = z.record(
  z.string(),
  z.object({
    caution: z.number().int().min(1).max(120),
    late: z.number().int().min(1).max(240),
  })
).nullable().optional()

export const KDSOrderBehaviorSchema = z.object({
  tapToStart: z.boolean(),
  mergeCards: z.boolean(),
  mergeWindowMinutes: z.number().int().min(0).max(60),
  newCardPerSend: z.boolean(),
  moveCompletedToBottom: z.boolean(),
  strikeThroughModifiers: z.boolean(),
  resetTimerOnRecall: z.boolean(),
  intelligentSort: z.boolean(),
  showAllDayCounts: z.boolean(),
  allDayCountResetHour: z.number().int().min(0).max(23),
  orderTrackerEnabled: z.boolean(),
  sendSmsOnReady: z.boolean(),
  printOnBump: z.boolean(),
  printerId: z.string().nullable(),
  autoExpireMinutes: z.number().int().min(0).max(1440), // 0=disabled, max 24h
}).partial().nullable().optional()

export const KDSOrderTypeFiltersSchema = z.record(
  z.string(),
  z.boolean()
).nullable().optional()

// Schema for creating/updating screen links
export const KDSScreenLinkCreateSchema = z.object({
  sourceScreenId: z.string().min(1),
  targetScreenId: z.string().min(1),
  linkType: KDSLinkTypeSchema,
  bumpAction: KDSBumpActionSchema.optional().default('bump'),
  resetStrikethroughsOnSend: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
})

export const KDSScreenLinkUpdateSchema = z.object({
  bumpAction: KDSBumpActionSchema.optional(),
  resetStrikethroughsOnSend: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

// Composite schema for KDS screen updates (new JSON fields)
export const KDSScreenJsonFieldsSchema = z.object({
  displayMode: KDSDisplayModeSchema.optional(),
  transitionTimes: KDSTransitionTimesSchema,
  orderBehavior: KDSOrderBehaviorSchema,
  orderTypeFilters: KDSOrderTypeFiltersSchema,
}).partial()
