/**
 * Comp/Void Domain Types
 *
 * Domain-level types for comp and void operations.
 * Route-level DTOs (NextRequest/NextResponse) stay in the route.
 */

import type { Prisma } from '@prisma/client'
type Decimal = Prisma.Decimal
import type { db } from '@/lib/db'

// ─── Transaction Client ─────────────────────────────────────────────────────

export type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0]

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface CompVoidInput {
  orderId: string
  itemId: string
  action: 'comp' | 'void'
  reason: string
  employeeId: string
  wasMade?: boolean
  approvedById?: string | null
  approvedAt?: Date | null
  remoteApprovalId?: string | null
  locationId: string
  /** Item data needed for logging (avoids re-fetch inside tx) */
  itemName: string
  itemQuantity: number
  itemTotal: number
  isBottleService: boolean
}

export interface RestoreInput {
  orderId: string
  itemId: string
  employeeId: string
  locationId: string
  locationSettings: { tax?: { defaultRate?: number } }
  isBottleService: boolean
}

export interface RecalcTotalsInput {
  orderId: string
  locationSettings: { tax?: { defaultRate?: number } }
  isBottleService: boolean
}

// ─── Results ────────────────────────────────────────────────────────────────

export interface OrderTotals {
  subtotal: number
  discountTotal: number
  taxTotal: number
  taxFromInclusive: number
  taxFromExclusive: number
  total: number
}

export interface ParentTotals extends OrderTotals {
  itemCount: number
}

export interface CardPaymentInfo {
  id: string
  datacapRecordNo: string | null
  paymentReaderId: string | null
  totalAmount: number | string
  refundedAmount: number | string | null
  cardLast4: string | null
  paymentMethod: string
}

export interface CompVoidTxResult {
  activeItemCount: number
  totals: OrderTotals
  shouldAutoClose: boolean
  parentTotals: ParentTotals | null
  cardPayments: CardPaymentInfo[]
}

export interface RestoreTxResult {
  totals: OrderTotals
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationError {
  error: string
  status: number
  requiresApproval?: boolean
  requiresRemoteApproval?: boolean
}

/** Accepts Prisma Decimal, number, or string for price fields */
type PriceValue = number | string | Decimal

export interface ItemForValidation {
  id: string
  status: string
  price: PriceValue
  quantity: number
  modifiers: Array<{ price: PriceValue }>
}

export interface OrderForValidation {
  id: string
  status: string
  locationId: string
  parentOrderId?: string | null
  payments?: Array<{ id: string; status: string }>
}

export interface ApprovalSettings {
  requireVoidApproval: boolean
  voidApprovalThreshold: number
}

export interface SecuritySettings {
  require2FAForLargeVoids: boolean
  void2FAThreshold: number
}
