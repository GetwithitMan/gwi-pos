import { z } from 'zod'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cake-orders')

// ============================================================================
// Cake Builder JSONB Schemas — SINGLE SOURCE OF TRUTH
// ============================================================================
//
// All JSONB column types for the cake ordering module are defined here as
// Zod schemas. TypeScript types are inferred — NO separate interfaces.
//
// Schema versioning: every top-level config uses `schemaVersion: 1` for
// forward-compatible lazy migration on read.
//
// Zod v4 (^4.3.6) — matches project package.json.
// ============================================================================

// ============================================================================
// Shared sub-schemas
// ============================================================================

/**
 * A single modifier selection stored inside a cake config.
 * References real ModifierGroup + Modifier IDs from the menu system.
 * Prices are snapshotted at order submission so menu changes don't
 * retroactively affect existing orders.
 */
export const cakeModifierSelectionSchema = z.object({
  modifierGroupId: z.string().min(1, 'Modifier group ID required'),
  modifierGroupName: z.string().min(1, 'Modifier group name required'),
  modifierId: z.string().min(1, 'Modifier ID required'),
  modifierName: z.string().min(1, 'Modifier name required'),
  price: z.number().nonnegative('Modifier price must be >= 0'),
})

export type CakeModifierSelection = z.infer<typeof cakeModifierSelectionSchema>

// ============================================================================
// CakeConfigV1 — tier-based cake configuration
// ============================================================================

/**
 * Per-tier configuration: a base menu item (cake size) plus selected modifiers
 * (flavor, filling, frosting, dietary). Prices are snapshotted.
 */
export const cakeTierConfigSchema = z.object({
  /** Tier position — 0 = bottom, ascending */
  index: z.number().int().nonnegative(),
  /** FK to MenuItem (e.g. "8\" Round Cake") */
  menuItemId: z.string().min(1),
  /** Display name snapshot */
  menuItemName: z.string().min(1),
  /** Price snapshot at order time (dollars) */
  menuItemPrice: z.number().nonnegative(),
  /** Per-tier modifier selections (flavor, filling, frosting, dietary) */
  modifiers: z.array(cakeModifierSelectionSchema),
})

export type CakeTierConfig = z.infer<typeof cakeTierConfigSchema>

/**
 * Full cake configuration stored in CakeOrder.cakeConfig JSONB.
 *
 * buildMode: 'quick_pick' when a preset was selected (auto-expanded into tiers),
 * 'custom' when customer selected each tier individually.
 *
 * Quick Pick and Custom both produce the same tier-based structure — Quick Pick
 * is a UI shortcut, not a data model.
 */
export const cakeConfigV1Schema = z.object({
  schemaVersion: z.literal(1),
  buildMode: z.enum(['quick_pick', 'custom']),
  /** Optional: the quick pick MenuItem ID that was selected (null for custom builds) */
  quickPickMenuItemId: z.string().nullable().optional(),
  /** At least one tier is required */
  tiers: z.array(cakeTierConfigSchema).min(1, 'At least one tier is required'),
})

export type CakeConfigV1 = z.infer<typeof cakeConfigV1Schema>

// ============================================================================
// DesignConfigV1 — colors, decorations, message, theme
// ============================================================================

/**
 * Design configuration stored in CakeOrder.designConfig JSONB.
 * Colors, cake-level decorations (not per-tier), inscription, and theme.
 */
export const designConfigV1Schema = z.object({
  schemaVersion: z.literal(1),
  /** Hex color values selected by the customer */
  colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color')),
  /** Cake-level decorations from the decoration modifier group (not per-tier) */
  decorations: z.array(cakeModifierSelectionSchema),
  /** Cake inscription text (null if none) */
  messageText: z.string().max(200, 'Message text must be 200 characters or fewer').nullable(),
  /** Placement of inscription: e.g. "top_tier_front", "bottom_tier_front" */
  messagePlacement: z.string().max(100).nullable(),
  /** Font style: "classic", "script", "modern", etc. */
  messageFont: z.string().max(50).nullable(),
  /** Theme: "rustic", "modern", "elegant", "whimsical", etc. (free text or dropdown) */
  theme: z.string().max(100).nullable(),
  /** Customer's free-text description of desired design */
  inspirationNotes: z.string().max(2000, 'Inspiration notes must be 2000 characters or fewer').nullable(),
})

export type DesignConfigV1 = z.infer<typeof designConfigV1Schema>

// ============================================================================
// DietaryConfigV1 — per-tier dietary requirements
// ============================================================================

/**
 * Per-tier dietary requirement entry.
 */
export const dietaryTierReqSchema = z.object({
  tierIndex: z.number().int().nonnegative(),
  /** Dietary modifier selections for this tier (e.g. "Vegan", "Gluten-Free") */
  modifiers: z.array(cakeModifierSelectionSchema),
  /** Customer's dietary notes for this tier */
  notes: z.string().max(500).nullable(),
})

export type DietaryTierReq = z.infer<typeof dietaryTierReqSchema>

/**
 * Dietary configuration stored in CakeOrder.dietaryConfig JSONB.
 */
export const dietaryConfigV1Schema = z.object({
  schemaVersion: z.literal(1),
  requirements: z.array(dietaryTierReqSchema),
})

export type DietaryConfigV1 = z.infer<typeof dietaryConfigV1Schema>

// ============================================================================
// PricingInputsV1 — computed pricing breakdown
// ============================================================================

/**
 * Per-tier pricing breakdown within PricingInputsV1.
 */
export const pricingTierBreakdownSchema = z.object({
  tierIndex: z.number().int().nonnegative(),
  menuItemId: z.string().min(1),
  menuItemName: z.string().min(1),
  basePrice: z.number().nonnegative(),
  flavorCost: z.number().nonnegative(),
  fillingCost: z.number().nonnegative(),
  frostingCost: z.number().nonnegative(),
  dietarySurcharge: z.number().nonnegative(),
})

export type PricingTierBreakdown = z.infer<typeof pricingTierBreakdownSchema>

/**
 * Decoration line item within PricingInputsV1.
 */
export const pricingDecorationBreakdownSchema = z.object({
  modifierId: z.string().min(1),
  name: z.string().min(1),
  price: z.number().nonnegative(),
})

export type PricingDecorationBreakdown = z.infer<typeof pricingDecorationBreakdownSchema>

/**
 * Complete pricing breakdown stored in CakeOrder.pricingInputs JSONB
 * and frozen into CakeQuote.pricingInputsSnapshot.
 *
 * All financial fields are in dollars (not cents), matching the POS convention.
 * The canonical total is `totalAfterTax`.
 */
export const pricingInputsV1Schema = z.object({
  schemaVersion: z.literal(1),
  /** Per-tier cost breakdown */
  tiers: z.array(pricingTierBreakdownSchema),
  /** SUM of all tier base + modifier costs */
  tierSubtotal: z.number().nonnegative(),
  /** Cake-level decoration cost breakdown */
  decorations: z.array(pricingDecorationBreakdownSchema),
  /** SUM of decoration prices */
  decorationSubtotal: z.number().nonnegative(),
  /** Inscription message charge (0 if no inscription) */
  messageCharge: z.number().nonnegative(),
  /** Rush fee (0 if outside rush window) */
  rushFee: z.number().nonnegative(),
  /** Setup / assembly fee */
  setupFee: z.number().nonnegative(),
  /** Delivery fee (0 if pickup) */
  deliveryFee: z.number().nonnegative(),
  /** Whether delivery fee is taxable (from venue settings — some states tax delivery) */
  deliveryFeeTaxable: z.boolean(),
  /** Discount amount (0 if none) */
  discountAmount: z.number().nonnegative(),
  /** Reason for discount (null if none) */
  discountReason: z.string().max(500).nullable(),
  /** tierSubtotal + decorationSubtotal + messageCharge */
  subtotal: z.number().nonnegative(),
  /** Tax rate frozen from venue settings at quote time */
  taxRateSnapshot: z.number().nonnegative(),
  /** Tax jurisdiction description frozen at quote time (e.g. "CO - Mesa County") */
  taxJurisdictionSnapshot: z.string().max(200),
  /** subtotal + rushFee + setupFee + (deliveryFee if taxable) + dietarySurcharge - discountAmount */
  taxableBase: z.number().nonnegative(),
  /** taxableBase * taxRateSnapshot */
  taxTotal: z.number().nonnegative(),
  /** Total before tax */
  totalBeforeTax: z.number().nonnegative(),
  /** THE canonical total — totalBeforeTax + taxTotal */
  totalAfterTax: z.number().nonnegative(),
  /** Deposit percentage frozen from settings at quote time */
  depositPercentSnapshot: z.number().nonnegative().max(100),
  /** totalAfterTax * depositPercentSnapshot / 100 */
  depositRequired: z.number().nonnegative(),
})

export type PricingInputsV1 = z.infer<typeof pricingInputsV1Schema>

// ============================================================================
// CakeQuoteLineItem — individual line in a quote
// ============================================================================

/**
 * A single line item in a CakeQuote.lineItems JSONB array.
 */
export const cakeQuoteLineItemSchema = z.object({
  label: z.string().min(1).max(200),
  description: z.string().max(500).nullable(),
  unitPrice: z.number().nonnegative(),
  quantity: z.number().int().positive(),
  lineTotal: z.number().nonnegative(),
  category: z.enum([
    'base_cake',
    'flavor',
    'filling',
    'frosting',
    'decoration',
    'dietary',
    'message',
    'rush_fee',
    'setup_fee',
    'delivery_fee',
    'discount',
  ]),
})

export type CakeQuoteLineItem = z.infer<typeof cakeQuoteLineItemSchema>

// ============================================================================
// Parse helpers with safe fallbacks
// ============================================================================

/**
 * Safely parse CakeConfigV1 from raw JSONB. Returns a sensible default
 * (single empty-tier custom config) on parse failure, logging the error.
 */
export function parseCakeConfig(json: unknown): CakeConfigV1 {
  const result = cakeConfigV1Schema.safeParse(json)
  if (result.success) return result.data
  log.error('[CakeConfig] Failed to parse cakeConfig JSONB:', result.error)
  return {
    schemaVersion: 1,
    buildMode: 'custom',
    quickPickMenuItemId: null,
    tiers: [],
  }
}

/**
 * Safely parse DesignConfigV1 from raw JSONB. Returns an empty design
 * config on parse failure, logging the error.
 */
export function parseDesignConfig(json: unknown): DesignConfigV1 {
  const result = designConfigV1Schema.safeParse(json)
  if (result.success) return result.data
  log.error('[CakeConfig] Failed to parse designConfig JSONB:', result.error)
  return {
    schemaVersion: 1,
    colors: [],
    decorations: [],
    messageText: null,
    messagePlacement: null,
    messageFont: null,
    theme: null,
    inspirationNotes: null,
  }
}

/**
 * Safely parse DietaryConfigV1 from raw JSONB. Returns an empty dietary
 * config on parse failure, logging the error.
 */
export function parseDietaryConfig(json: unknown): DietaryConfigV1 {
  const result = dietaryConfigV1Schema.safeParse(json)
  if (result.success) return result.data
  log.error('[CakeConfig] Failed to parse dietaryConfig JSONB:', result.error)
  return {
    schemaVersion: 1,
    requirements: [],
  }
}

/**
 * Safely parse PricingInputsV1 from raw JSONB. Returns a zero-valued
 * pricing breakdown on parse failure, logging the error.
 */
export function parsePricingInputs(json: unknown): PricingInputsV1 {
  const result = pricingInputsV1Schema.safeParse(json)
  if (result.success) return result.data
  log.error('[CakeConfig] Failed to parse pricingInputs JSONB:', result.error)
  return {
    schemaVersion: 1,
    tiers: [],
    tierSubtotal: 0,
    decorations: [],
    decorationSubtotal: 0,
    messageCharge: 0,
    rushFee: 0,
    setupFee: 0,
    deliveryFee: 0,
    deliveryFeeTaxable: false,
    discountAmount: 0,
    discountReason: null,
    subtotal: 0,
    taxRateSnapshot: 0,
    taxJurisdictionSnapshot: '',
    taxableBase: 0,
    taxTotal: 0,
    totalBeforeTax: 0,
    totalAfterTax: 0,
    depositPercentSnapshot: 0,
    depositRequired: 0,
  }
}

// ============================================================================
// Enums & Constants
// ============================================================================

/** Settlement order types for cake deposit and balance payments */
export const CAKE_SETTLEMENT_TYPES = ['cake_deposit_settlement', 'cake_balance_settlement'] as const
export type CakeSettlementType = typeof CAKE_SETTLEMENT_TYPES[number]

/** All cake order statuses — matches DB CHECK constraint */
export const CAKE_ORDER_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'quoted',
  'approved',
  'deposit_paid',
  'in_production',
  'ready',
  'delivered',
  'completed',
  'cancelled',
] as const
export type CakeOrderStatus = typeof CAKE_ORDER_STATUSES[number]

/** Quote statuses — matches DB CHECK constraint */
export const CAKE_QUOTE_STATUSES = ['draft', 'sent', 'approved', 'voided', 'expired'] as const
export type CakeQuoteStatus = typeof CAKE_QUOTE_STATUSES[number]

/** Payment types: payment (money in), refund (money out), forfeit (retained deposit) */
export const CAKE_PAYMENT_TYPES = ['payment', 'refund', 'forfeit'] as const
export type CakePaymentType = typeof CAKE_PAYMENT_TYPES[number]

/** Which bucket a payment applies to */
export const CAKE_PAYMENT_APPLIED_TO = ['deposit', 'balance'] as const
export type CakePaymentAppliedTo = typeof CAKE_PAYMENT_APPLIED_TO[number]

/** Payment origin: POS (Datacap settlement order) or external (cash/check/venmo) */
export const CAKE_PAYMENT_SOURCES = ['pos', 'external'] as const
export type CakePaymentSource = typeof CAKE_PAYMENT_SOURCES[number]

/** Payment methods for external payments */
export const CAKE_PAYMENT_METHODS = ['cash', 'card', 'check', 'venmo', 'other'] as const
export type CakePaymentMethod = typeof CAKE_PAYMENT_METHODS[number]

/** Audit trail change types — matches DB CHECK constraint */
export const CAKE_CHANGE_TYPES = [
  'status_change',
  'quote_created',
  'quote_voided',
  'quote_approved',
  'payment_recorded',
  'payment_refunded',
  'config_edited',
  'assignment_changed',
  'note_added',
] as const
export type CakeChangeType = typeof CAKE_CHANGE_TYPES[number]

/** Delivery type options */
export const CAKE_DELIVERY_TYPES = ['pickup', 'delivery', 'venue_delivery', 'customer_delivery'] as const
export type CakeDeliveryType = typeof CAKE_DELIVERY_TYPES[number]

/** Order sources — how the order was created */
export const CAKE_ORDER_SOURCES = ['public_form', 'admin', 'in_store', 'customer_portal', 'android'] as const
export type CakeOrderSource = typeof CAKE_ORDER_SOURCES[number]

/** Change log sources */
export const CAKE_CHANGE_SOURCES = ['admin', 'public_form', 'customer_portal', 'system', 'android'] as const
export type CakeChangeSource = typeof CAKE_CHANGE_SOURCES[number]

// ============================================================================
// API Request Schemas — route validation
// ============================================================================

/**
 * Public form submission — customer creates a cake order.
 * Rate-limited, honeypot-protected, submissionToken for idempotency.
 */
export const createCakeOrderSchema = z.object({
  /** Client UUID for idempotency (prevents double-submit) */
  submissionToken: z.string().min(1).max(100),
  /** Event details */
  eventDate: z.string().date('Must be a valid date (YYYY-MM-DD)'),
  eventTimeStart: z.string().max(20).nullable().optional(),
  eventTimeEnd: z.string().max(20).nullable().optional(),
  eventType: z.string().min(1).max(100),
  guestCount: z.number().int().nonnegative().optional(),
  /** Delivery */
  deliveryType: z.enum(CAKE_DELIVERY_TYPES),
  deliveryAddress: z.string().max(500).nullable().optional(),
  /** Cake configuration */
  cakeConfig: cakeConfigV1Schema,
  designConfig: designConfigV1Schema,
  dietaryConfig: dietaryConfigV1Schema,
  /** Customer info (for find-or-create) */
  customerFirstName: z.string().min(1, 'First name required').max(100),
  customerLastName: z.string().min(1, 'Last name required').max(100),
  customerEmail: z.string().email().max(254).nullable().optional(),
  customerPhone: z.string().min(7, 'Phone number required').max(20),
  preferredContactMethod: z.enum(['phone', 'email', 'text']).optional(),
  /** Customer notes / special requests */
  notes: z.string().max(2000).nullable().optional(),
  /** Honeypot field — must be empty (bots fill it) */
  _hp: z.string().max(0).optional(),
})

export type CreateCakeOrderInput = z.infer<typeof createCakeOrderSchema>

/**
 * Admin or phone-in cake order creation.
 * Staff creates on behalf of customer. No submissionToken needed.
 */
export const adminCreateCakeOrderSchema = z.object({
  /** Existing customer ID or null to create new */
  customerId: z.string().min(1).nullable().optional(),
  /** Customer info for creation (used when customerId is null) */
  customerFirstName: z.string().max(100).optional(),
  customerLastName: z.string().max(100).optional(),
  customerEmail: z.string().email().max(254).nullable().optional(),
  customerPhone: z.string().min(7).max(20).optional(),
  /** Event details */
  eventDate: z.string().date('Must be a valid date (YYYY-MM-DD)'),
  eventTimeStart: z.string().max(20).nullable().optional(),
  eventTimeEnd: z.string().max(20).nullable().optional(),
  eventType: z.string().min(1).max(100),
  guestCount: z.number().int().nonnegative().optional(),
  /** Delivery */
  deliveryType: z.enum(CAKE_DELIVERY_TYPES),
  deliveryAddress: z.string().max(500).nullable().optional(),
  /** Cake configuration */
  cakeConfig: cakeConfigV1Schema,
  designConfig: designConfigV1Schema,
  dietaryConfig: dietaryConfigV1Schema,
  /** Notes */
  notes: z.string().max(2000).nullable().optional(),
  internalNotes: z.string().max(2000).nullable().optional(),
  /** Start as draft or submitted */
  status: z.enum(['draft', 'submitted']).optional(),
  /** Order source */
  source: z.enum(CAKE_ORDER_SOURCES).optional(),
})

export type AdminCreateCakeOrderInput = z.infer<typeof adminCreateCakeOrderSchema>

/**
 * PATCH updates to an existing cake order.
 * Uses expectedUpdatedAt for optimistic concurrency control.
 * Only price-affecting changes will auto-void active quotes.
 */
export const updateCakeOrderSchema = z.object({
  /** Optimistic concurrency: the updatedAt the client last saw */
  expectedUpdatedAt: z.string().datetime(),
  /** Event details */
  eventDate: z.string().date().optional(),
  eventTimeStart: z.string().max(20).nullable().optional(),
  eventTimeEnd: z.string().max(20).nullable().optional(),
  eventType: z.string().max(100).optional(),
  guestCount: z.number().int().nonnegative().optional(),
  /** Delivery */
  deliveryType: z.enum(CAKE_DELIVERY_TYPES).optional(),
  deliveryAddress: z.string().max(500).nullable().optional(),
  /** Cake configuration */
  cakeConfig: cakeConfigV1Schema.optional(),
  designConfig: designConfigV1Schema.optional(),
  dietaryConfig: dietaryConfigV1Schema.optional(),
  /** Notes */
  notes: z.string().max(2000).nullable().optional(),
  internalNotes: z.string().max(2000).nullable().optional(),
  /** Baker assignment */
  assignedTo: z.string().min(1).nullable().optional(),
  /** Customer ID (for linking on draft -> submit) */
  customerId: z.string().min(1).nullable().optional(),
})

export type UpdateCakeOrderInput = z.infer<typeof updateCakeOrderSchema>

/**
 * Create a quote for a cake order. Line items and pricing are assembled
 * server-side from the order's adminCurrent snapshot — NOT from live menu.
 */
export const createQuoteSchema = z.object({
  /** Optional discount to apply */
  discountAmount: z.number().nonnegative().optional(),
  discountReason: z.string().max(500).nullable().optional(),
  /** Quote validity period */
  validUntilDate: z.string().date('Must be a valid date (YYYY-MM-DD)'),
  /** Override pricing (admin can adjust individual line items) */
  lineItemOverrides: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        unitPrice: z.number().nonnegative(),
        quantity: z.number().int().positive(),
      })
    )
    .optional(),
})

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>

/**
 * Approve a quote. Protected by stale-read check:
 * if the quote was voided/expired between page load and approval, returns 409.
 */
export const approveQuoteSchema = z.object({
  /** Optimistic concurrency: the updatedAt the client last saw on the CakeOrder */
  expectedUpdatedAt: z.string().datetime(),
})

export type ApproveQuoteInput = z.infer<typeof approveQuoteSchema>

/**
 * Record a payment (deposit or balance) against a cake order.
 * POS payments create a settlement order + Datacap transaction.
 * External payments are manual records (cash, check, venmo, other).
 */
export const recordPaymentSchema = z.object({
  /** Payment or refund */
  type: z.enum(['payment', 'refund', 'forfeit']),
  /** Which bucket this applies to */
  appliedTo: z.enum(CAKE_PAYMENT_APPLIED_TO),
  /** Payment origin */
  paymentSource: z.enum(CAKE_PAYMENT_SOURCES),
  /** Amount in dollars — positive even for refunds */
  amount: z.number().positive('Amount must be greater than 0'),
  /** Method (required for external payments) */
  method: z.enum(CAKE_PAYMENT_METHODS).optional(),
  /** Reference number (REQUIRED when method = check or other) */
  reference: z.string().max(200).nullable().optional(),
  /** Notes (REQUIRED when type = refund AND paymentSource = external) */
  notes: z.string().max(500).nullable().optional(),
  /** For refunds: the CakePayment ID being reversed */
  reversesCakePaymentId: z.string().min(1).nullable().optional(),
})

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>

/**
 * Request a text-to-pay payment link for deposit or balance.
 * Sends SMS to the customer via existing Twilio + PaymentLink system.
 * Idempotent: same (cakeOrderId, appliedTo, amount) returns existing active link.
 */
export const requestPaymentSchema = z.object({
  /** Which bucket to collect payment for */
  appliedTo: z.enum(CAKE_PAYMENT_APPLIED_TO),
  /** Amount to request (dollars) */
  amount: z.number().positive('Amount must be greater than 0'),
  /** Optional custom message to include in the SMS */
  message: z.string().max(500).nullable().optional(),
})

export type RequestPaymentInput = z.infer<typeof requestPaymentSchema>

/**
 * Transition a cake order to a new status.
 * State machine enforced server-side. Reason required for cancellations.
 */
export const transitionStatusSchema = z.object({
  /** Target status */
  status: z.enum(CAKE_ORDER_STATUSES),
  /** Reason (REQUIRED for cancellations and rollbacks) */
  reason: z.string().min(1, 'Reason is required').max(500).nullable().optional(),
  /** Optimistic concurrency */
  expectedUpdatedAt: z.string().datetime().optional(),
})

export type TransitionStatusInput = z.infer<typeof transitionStatusSchema>

// ============================================================================
// Cancellation policy snapshot — frozen at quote approval
// ============================================================================

/**
 * Cancellation policy snapshot frozen into CakeQuote at approval time.
 * Prevents retroactive policy changes on old orders.
 */
export const cancellationPolicySnapshotSchema = z.object({
  forfeitDaysBeforeSnapshot: z.number().int().nonnegative(),
  depositForfeitPercentSnapshot: z.number().nonnegative().max(100),
  lateCancelPolicyTextSnapshot: z.string().max(1000),
})

export type CancellationPolicySnapshot = z.infer<typeof cancellationPolicySnapshotSchema>

// ============================================================================
// Settlement order metadata — stored in Order.metadata JSONB
// ============================================================================

/**
 * Metadata stored on POS settlement Order.metadata JSONB for
 * linking back to the originating CakeOrder.
 */
export const cakeSettlementMetadataSchema = z.object({
  cakeOrderId: z.string().min(1),
  appliedTo: z.enum(CAKE_PAYMENT_APPLIED_TO),
})

export type CakeSettlementMetadata = z.infer<typeof cakeSettlementMetadataSchema>
