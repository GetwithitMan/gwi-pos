/**
 * Tab Close Domain Types
 *
 * Domain-level types for tab close processing.
 * No framework imports (NextRequest/NextResponse) — route-agnostic.
 */

import type { Prisma } from '@/generated/prisma/client'

// ─── Transaction Client ─────────────────────────────────────────────────────

export type TxClient = Prisma.TransactionClient

// ─── Input ──────────────────────────────────────────────────────────────────

/** Input to the tab-close validation phase */
export interface TabCloseInput {
  orderId: string
  employeeId: string
  tipMode: 'device' | 'receipt' | 'included'
  tipAmount?: number
  orderCardId?: string
  version?: number
}

// ─── Validation Results ─────────────────────────────────────────────────────

/** Result from Phase 1 validation — discriminated union */
export type TabCloseValidationResult =
  | { valid: true; order: TabCloseOrder; versionBeforeClose: number }
  | { valid: false; error: string; status: number; extra?: Record<string, unknown> }

// ─── Order Shape ────────────────────────────────────────────────────────────

/** Minimal order shape needed by tab-close domain */
export interface TabCloseOrder {
  id: string
  locationId: string
  employeeId: string | null
  status: string
  tabStatus: string | null
  total: unknown // Prisma Decimal
  tipTotal: unknown // Prisma Decimal
  guestCount: number
  tableId: string | null
  isBottleService: boolean
  bottleServiceTierId: string | null
  version: number
  updatedAt: Date | null
  cards: TabCloseCard[]
  items: { id: string }[]
}

/** Card shape for tab-close domain */
export interface TabCloseCard {
  id: string
  readerId: string
  recordNo: string
  cardLast4: string
  cardType: string | null
  status: string
  isDefault: boolean
  createdAt: Date
}

// ─── Computation Results ────────────────────────────────────────────────────

/** Result from resolveCardsToCharge */
export type CardResolutionResult =
  | { valid: true; cards: TabCloseCard[] }
  | { valid: false; error: string; code?: string; cards?: Array<{ id: string; last4: string; cardType: string | null }> }

// ─── Zero Tab ───────────────────────────────────────────────────────────────

export interface ZeroTabReleaseResult {
  cardId: string
  cardLast4: string
  released: boolean
  error?: string
}

// ─── Capture ────────────────────────────────────────────────────────────────

/** Result from recording capture failure */
export interface CaptureFailureResult {
  retryCount: number
  maxRetries: number
}

/** Input for recording a successful capture */
export interface CaptureSuccessInput {
  orderId: string
  locationId: string
  employeeId: string
  sellingEmployeeId: string | null
  capturedCard: TabCloseCard
  purchaseAmount: number
  tipAmount: number
  totalCaptured: number
  authCode: string | null
  cardType: string | null
  allCards: TabCloseCard[]
  datacapResponse: { acqRefData?: string; processData?: string; aid?: string; cvm?: string | number; level2Status?: string }
  now: Date
}

// ─── Auto-Gratuity ─────────────────────────────────────────────────────────

export interface BottleServiceTier {
  autoGratuityPercent: unknown // Prisma Decimal — converted via Number() in resolveAutoGratuity
  minimumSpend: unknown // Prisma Decimal
}
