/**
 * Payment Domain Types
 *
 * Domain-level types for payment processing.
 * Route-level DTOs (NextRequest/NextResponse) stay in the route.
 */

import type { PaymentMethod, PaymentStatus } from '@/generated/prisma/client'
import type { db } from '@/lib/db'

// ─── Transaction Client ─────────────────────────────────────────────────────

export type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0]

// ─── Payment Input ──────────────────────────────────────────────────────────

export interface PaymentInput {
  method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account' | 'loyalty_points' | 'room_charge'
  amount: number
  tipAmount?: number
  // Cash specific
  amountTendered?: number
  // Card specific
  cardBrand?: string
  cardLast4?: string
  // Gift card specific
  giftCardId?: string
  giftCardNumber?: string
  // House account specific
  houseAccountId?: string
  // Hotel PMS / Bill to Room fields
  selectionId?: string
  roomNumber?: string
  guestName?: string
  pmsReservationId?: string
  // Loyalty points specific
  pointsUsed?: number
  // Datacap Direct fields
  datacapRecordNo?: string
  datacapRefNumber?: string
  datacapSequenceNo?: string
  authCode?: string
  entryMethod?: string
  signatureData?: string
  amountAuthorized?: number
  // Datacap processor metadata for ByRecordNo ops + chargeback defense
  acqRefData?: string
  processData?: string
  aid?: string
  cvm?: string
  avsResult?: string
  level2Status?: string
  tokenFrequency?: string
  // SAF (Store-and-Forward) — transaction stored offline on reader
  storedOffline?: boolean
}

// ─── Payment Record ─────────────────────────────────────────────────────────

export interface PaymentRecord {
  locationId: string
  orderId: string
  employeeId: string | null
  drawerId?: string | null
  shiftId?: string | null
  terminalId?: string | null
  amount: number
  tipAmount: number
  totalAmount: number
  paymentMethod: PaymentMethod
  amountTendered?: number
  changeGiven?: number
  roundingAdjustment?: number
  cardBrand?: string
  cardLast4?: string
  authCode?: string
  transactionId?: string
  datacapRecordNo?: string
  datacapRefNumber?: string
  datacapSequenceNo?: string
  entryMethod?: string
  signatureData?: string
  amountAuthorized?: number
  amountRequested?: number
  isOfflineCapture?: boolean
  safStatus?: string
  // Datacap processor metadata
  acqRefData?: string | null
  processData?: string | null
  aid?: string | null
  cvmResult?: string | null
  avsResult?: string | null
  level2Status?: string | null
  tokenFrequency?: string | null
  cashDiscountAmount?: number
  priceBeforeDiscount?: number
  pricingMode?: string
  idempotencyKey?: string
  // Hotel PMS / Bill to Room
  roomNumber?: string
  guestName?: string
  pmsReservationId?: string
  pmsTransactionId?: string
  status: PaymentStatus
}

// ─── Drawer Attribution ─────────────────────────────────────────────────────

export interface DrawerAttribution {
  drawerId: string | null
  shiftId: string | null
}

// ─── Auto-Gratuity Result ───────────────────────────────────────────────────

export interface AutoGratuityResult {
  applied: boolean
  note: string | null
  tippableIndex: number
  amount: number
}

// ─── Order Finalization ─────────────────────────────────────────────────────

export interface OrderStatusResult {
  status: 'paid' | 'in_progress' | null
  paidAt: Date | null
  closedAt: Date | null
}

export interface OrderUpdateData {
  tipTotal: number
  primaryPaymentMethod?: PaymentMethod
  status?: string
  paidAt?: Date
  closedAt?: Date
  businessDayDate: Date
}

// ─── Receipt Data ───────────────────────────────────────────────────────────

export interface ReceiptPayment {
  method: string
  amount: number
  tipAmount: number
  totalAmount: number
  cardBrand?: string | null
  cardLast4?: string | null
  authCode?: string | null
  amountTendered?: number | null
  changeGiven?: number | null
}

export interface ReceiptData {
  id: string
  orderNumber: number | null
  displayNumber: string | null
  orderType: string | null
  tabName: string | null
  tableName: string | null
  guestCount: number
  employee: { id: string; name: string }
  location: { name: string; address: string | null; phone: string | null }
  items: Array<{
    id: string
    name: string
    quantity: number
    price: number
    itemTotal: number
    specialNotes: string | null
    status: string
    modifiers: Array<{
      id: string
      name: string
      price: number
      preModifier: string | null
      isCustomEntry?: boolean
      isNoneSelection?: boolean
      customEntryName?: string | null
      customEntryPrice?: number | null
      swapTargetName?: string | null
    }>
  }>
  payments: ReceiptPayment[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  taxFromInclusive?: number
  taxFromExclusive?: number
  tipTotal: number
  total: number
  createdAt: string
  paidAt: string
  customer: {
    name: string
    loyaltyPoints: number
    phone: string | null
    email: string | null
  } | null
  loyaltyPointsRedeemed: number | null
  loyaltyPointsEarned: number | null
  surchargeDisclosure: string | null
}
