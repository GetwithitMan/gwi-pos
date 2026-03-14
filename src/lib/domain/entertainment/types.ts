/**
 * Entertainment Domain Types
 *
 * Domain-level types for entertainment/timed-rental session management.
 * Route-level DTOs (NextRequest/NextResponse) stay in the route.
 */

import type { db } from '@/lib/db'
import type {
  EntertainmentPricing,
  OvertimeConfig,
  ChargeBreakdown,
  HappyHourConfig,
} from '@/lib/entertainment-pricing'

// ─── Transaction Client ─────────────────────────────────────────────────────

export type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0]

// ─── Re-exports from entertainment-pricing for convenience ───────────────────

export type {
  EntertainmentPricing,
  OvertimeConfig,
  ChargeBreakdown,
  HappyHourConfig,
}

// ─── Menu Item Fields ────────────────────────────────────────────────────────

/** The subset of MenuItem fields needed for pricing calculations */
export interface MenuItemPricingFields {
  id: string
  name: string
  price: unknown // Decimal comes as string from Prisma
  timedPricing: unknown // Json column
  ratePerMinute: unknown // Decimal | null
  minimumCharge: unknown // Decimal | null
  incrementMinutes: number | null
  graceMinutes: number | null
  blockTimeMinutes: number | null
  happyHourEnabled: boolean | null
  happyHourDiscount: number | null
  happyHourStart: string | null
  happyHourEnd: string | null
  happyHourDays: unknown // Json | null
  overtimeEnabled: boolean | null
  overtimeMode: string | null
  overtimeMultiplier: unknown // Decimal | null
  overtimePerMinuteRate: unknown // Decimal | null
  overtimeFlatFee: unknown // Decimal | null
  overtimeGraceMinutes: number | null
  prepaidPackages?: unknown // Json | null
}

// ─── Session Start ───────────────────────────────────────────────────────────

export interface StartSessionInput {
  orderItemId: string
  menuItemId: string
  orderId: string
  locationId: string
  minutes: number
  initialPrice: number
  now: Date
  expiresAt: Date
}

export interface StartSessionResult {
  conflict: boolean
  waitlistConflict: boolean
  updatedItem: {
    id: string
    name: string | null
    blockTimeMinutes: number | null
    blockTimeStartedAt: Date | null
    blockTimeExpiresAt: Date | null
    menuItemId: string | null
  } | null
  notifiedCustomer: string | null
}

// ─── Session Stop ────────────────────────────────────────────────────────────

export type StopReason = 'normal' | 'comp' | 'void' | 'force'

export interface StopSessionInput {
  orderItemId: string
  menuItemId: string
  orderId: string
  locationId: string
  reason: StopReason
  now: Date
  menuItem: MenuItemPricingFields
}

export interface StopSessionResult {
  alreadyProcessed: boolean
  actualMinutes: number
  calculatedCharge: number
  breakdown: ChargeBreakdown | null
  overtimeBreakdown: { overtimeMinutes: number; overtimeCharge: number } | null
  updatedMenuItem: {
    id: string
    name: string
    entertainmentStatus: string | null
    currentOrderId: string | null
    currentOrderItemId: string | null
  } | null
}

// ─── Session Extend ──────────────────────────────────────────────────────────

export interface ExtendSessionInput {
  orderItemId: string
  menuItemId: string
  additionalMinutes: number
  menuItem: MenuItemPricingFields
}

export interface ExtendSessionResult {
  updatedItem: {
    id: string
    name: string | null
    blockTimeMinutes: number | null
    blockTimeStartedAt: Date | null
    blockTimeExpiresAt: Date | null
  }
  newExpiresAt: Date
  newTotalMinutes: number
  newPrice: number
}

// ─── Session Time Override ───────────────────────────────────────────────────

export interface TimeOverrideInput {
  orderItemId: string
  menuItemId: string
  parsedExpiresAt: Date
  menuItem: MenuItemPricingFields
}

// ─── Session Expiry (Cron) ───────────────────────────────────────────────────

export interface ExpireSessionItem {
  id: string // OrderItem ID
  menuItem: {
    id: string
    name: string
    price: unknown
    ratePerMinute: unknown
    minimumCharge: unknown
    incrementMinutes: number | null
    graceMinutes: number | null
    timedPricing: unknown
    happyHourEnabled: boolean | null
    happyHourDiscount: number | null
    happyHourStart: string | null
    happyHourEnd: string | null
    happyHourDays: unknown
    overtimeEnabled: boolean | null
    overtimeMode: string | null
    overtimeMultiplier: unknown
    overtimePerMinuteRate: unknown
    overtimeFlatFee: unknown
    overtimeGraceMinutes: number | null
  }
  order: {
    id: string
    locationId: string
    status: string
  }
}

// ─── Stop-All ────────────────────────────────────────────────────────────────

export interface StopAllSessionResult {
  orderItemId: string
  menuItemId: string
  menuItemName: string
  orderId: string
  actualMinutes: number
  charge: number
}

// ─── Waitlist ────────────────────────────────────────────────────────────────

export interface WaitlistTimeInfo {
  waitMinutes: number
  waitTimeFormatted: string
}
