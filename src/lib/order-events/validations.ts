import { z } from 'zod'
import { ORDER_EVENT_TYPES } from './types'

// ── Common fragments ────────────────────────────────────────────────

const idSchema = z.string().min(1)
const centsSchema = z.number().int()
const quantitySchema = z.number().positive()
const optionalString = z.string().nullable().optional()
const optionalNumber = z.number().nullable().optional()
const optionalBoolean = z.boolean().nullable().optional()

// ── Payload Schemas ─────────────────────────────────────────────────

export const OrderCreatedSchema = z.object({
  locationId: idSchema,
  employeeId: idSchema,
  orderType: z.string(),
  tableId: optionalString,
  tabName: optionalString,
  guestCount: z.number().int().nonnegative(),
  orderNumber: z.number().int().nonnegative(),
  displayNumber: optionalString,
})

export const ItemAddedSchema = z.object({
  lineItemId: idSchema,
  menuItemId: idSchema,
  name: z.string(),
  priceCents: centsSchema,
  quantity: quantitySchema,
  isTaxInclusive: z.boolean().optional(),
  modifiersJson: optionalString,
  specialNotes: optionalString,
  seatNumber: optionalNumber,
  courseNumber: optionalNumber,
  isHeld: z.boolean(),
  soldByWeight: z.boolean(),
  weight: optionalNumber,
  weightUnit: optionalString,
  unitPriceCents: optionalNumber,
  grossWeight: optionalNumber,
  tareWeight: optionalNumber,
  pricingOptionId: optionalString,
  pricingOptionLabel: optionalString,
  costAtSaleCents: optionalNumber,
  pourSize: optionalString,
  pourMultiplier: optionalNumber,
})

export const ItemRemovedSchema = z.object({
  lineItemId: idSchema,
  reason: optionalString,
  managerApprovalEmployeeId: optionalString,
  removedAfterSend: optionalBoolean,
})

export const ItemUpdatedSchema = z.object({
  lineItemId: idSchema,
  isHeld: optionalBoolean,
  specialNotes: optionalString,
  courseNumber: optionalNumber,
  seatNumber: optionalNumber,
  quantity: optionalNumber,
  delayMinutes: optionalNumber,
  kitchenStatus: optionalString,
  status: optionalString,
  isCompleted: optionalBoolean,
  resendCount: optionalNumber,
})

export const OrderSentSchema = z.object({
  sentItemIds: z.array(z.string()),
})

export const PaymentAppliedSchema = z.object({
  paymentId: idSchema,
  method: z.string(),
  amountCents: centsSchema,
  tipCents: centsSchema,
  totalCents: centsSchema,
  cardBrand: optionalString,
  cardLast4: optionalString,
  status: z.string(),
})

export const PaymentVoidedSchema = z.object({
  paymentId: idSchema,
  reason: optionalString,
  employeeId: optionalString,
})

export const OrderClosedSchema = z.object({
  reason: optionalString,
  closedStatus: z.string(),
})

export const OrderReopenedSchema = z.object({
  reason: optionalString,
})

export const DiscountAppliedSchema = z.object({
  discountId: idSchema,
  type: z.enum(['amount', 'percent']),
  value: z.number(),
  amountCents: centsSchema,
  reason: optionalString,
  lineItemId: optionalString,
})

export const DiscountRemovedSchema = z.object({
  discountId: idSchema,
  lineItemId: optionalString,
})

export const TabOpenedSchema = z.object({
  cardLast4: optionalString,
  preAuthId: optionalString,
  tabName: optionalString,
})

export const TabClosedSchema = z.object({
  employeeId: idSchema,
  tipCents: optionalNumber,
  adjustedAmountCents: optionalNumber,
})

export const GuestCountChangedSchema = z.object({
  count: z.number().int().nonnegative(),
})

export const NoteChangedSchema = z.object({
  note: optionalString,
})

export const OrderMetadataUpdatedSchema = z.object({
  tabName: optionalString,
  tableId: optionalString,
  tableName: optionalString,
  employeeId: optionalString,
  customerId: optionalString,
  tabStatus: optionalString,
})

export const CompVoidAppliedSchema = z.object({
  lineItemId: optionalString,
  action: z.enum(['comp', 'void', 'uncomp', 'unvoid']),
  reason: optionalString,
  employeeId: idSchema,
  approvedById: optionalString,
})

export const ItemModifierRemovedSchema = z.object({
  lineItemId: idSchema,
  modifierId: optionalString,
  modifierName: optionalString,
  reason: optionalString,
})

export const TabCaptureDeclinedSchema = z.object({
  employeeId: idSchema,
  errorMessage: z.string(),
  retryCount: z.number().int(),
  maxRetries: z.number().int(),
})

export const WalkoutMarkedSchema = z.object({
  reason: z.string(),
  retryCount: optionalNumber,
  employeeId: optionalString,
})

export const RefundAppliedSchema = z.object({
  paymentId: idSchema,
  refundAmountCents: centsSchema,
  reason: optionalString,
  employeeId: optionalString,
})

// ── Validator Map ────────────────────────────────────────────────────

export const PayloadValidators = {
  ORDER_CREATED: OrderCreatedSchema,
  ITEM_ADDED: ItemAddedSchema,
  ITEM_REMOVED: ItemRemovedSchema,
  ITEM_UPDATED: ItemUpdatedSchema,
  ORDER_SENT: OrderSentSchema,
  PAYMENT_APPLIED: PaymentAppliedSchema,
  PAYMENT_VOIDED: PaymentVoidedSchema,
  ORDER_CLOSED: OrderClosedSchema,
  ORDER_REOPENED: OrderReopenedSchema,
  DISCOUNT_APPLIED: DiscountAppliedSchema,
  DISCOUNT_REMOVED: DiscountRemovedSchema,
  TAB_OPENED: TabOpenedSchema,
  TAB_CLOSED: TabClosedSchema,
  GUEST_COUNT_CHANGED: GuestCountChangedSchema,
  NOTE_CHANGED: NoteChangedSchema,
  ORDER_METADATA_UPDATED: OrderMetadataUpdatedSchema,
  COMP_VOID_APPLIED: CompVoidAppliedSchema,
  ITEM_MODIFIER_REMOVED: ItemModifierRemovedSchema,
  TAB_CAPTURE_DECLINED: TabCaptureDeclinedSchema,
  WALKOUT_MARKED: WalkoutMarkedSchema,
  REFUND_APPLIED: RefundAppliedSchema,
} as const

// ── Batch Input Schema ───────────────────────────────────────────────

export const BatchEventSchema = z.object({
  eventId: idSchema,
  orderId: idSchema,
  deviceId: idSchema,
  deviceCounter: z.number().int(),
  type: z.enum(ORDER_EVENT_TYPES),
  payloadJson: z.record(z.string(), z.any()),
  schemaVersion: z.number().int().optional(),
  correlationId: optionalString,
  deviceCreatedAt: z.number().int(),
})

export const BatchRequestSchema = z.object({
  events: z.array(BatchEventSchema),
})

/**
 * Validates an event payload against its type-specific schema.
 * Throws ZodError if invalid.
 */
export function validateEventPayload<K extends keyof typeof PayloadValidators>(
  type: K,
  payload: unknown
) {
  const validator = PayloadValidators[type]
  if (!validator) {
    throw new Error(`No validator defined for event type: ${type}`)
  }
  return (validator as z.ZodSchema).parse(payload) as z.infer<(typeof PayloadValidators)[K]>
}
