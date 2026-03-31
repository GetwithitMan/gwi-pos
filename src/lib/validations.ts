import { z } from 'zod'

// ============================================
// Common validation patterns
// ============================================

// ID validation - flexible to support various ID formats (CUID, UUID, etc.)
const idSchema = z.string().min(1, 'ID is required')
const pinSchema = z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits')
const emailSchema = z.string().email().optional().or(z.literal(''))
const phoneSchema = z.string().min(7).max(20).optional().or(z.literal(''))
const positiveNumber = z.number().positive()
const nonNegativeNumber = z.number().nonnegative()

// ============================================
// Employee schemas
// ============================================

export const createEmployeeSchema = z.object({
  locationId: idSchema,
  firstName: z.string().min(1, 'First name required').max(50),
  lastName: z.string().min(1, 'Last name required').max(50),
  displayName: z.string().max(50).optional(),
  email: emailSchema,
  phone: phoneSchema,
  pin: pinSchema,
  roleId: idSchema,
  hourlyRate: positiveNumber.optional(),
  hireDate: z.string().date().or(z.string().datetime()).optional(),
  color: z.string().max(20).optional(),
})

// ============================================
// Order schemas
// ============================================

const orderItemModifierSchema = z.object({
  modifierId: z.string(),
  name: z.string(),
  price: nonNegativeNumber,
  preModifier: z.string().nullable().optional(),
  depth: z.number().int().nonnegative().optional(), // Modifier hierarchy depth: 0=top, 1=child, 2=grandchild
  // Liquor Builder spirit selection fields
  spiritTier: z.string().nullable().optional(),
  linkedBottleProductId: z.string().nullable().optional(),
  parentModifierId: z.string().nullable().optional(),
  // Open Entry — freeform custom modifier created at POS
  isCustomEntry: z.boolean().optional(),
  customEntryName: z.string().nullable().optional(),
  customEntryPrice: z.number().nullable().optional(),
  // None Selection — explicit "None" on a required modifier group
  isNoneSelection: z.boolean().optional(),
  noneShowOnReceipt: z.boolean().optional(),
  // Swap — substitution fields
  swapTargetName: z.string().nullable().optional(),
  swapTargetItemId: z.string().nullable().optional(),
  swapPricingMode: z.string().nullable().optional(),
  swapEffectivePrice: z.number().nullable().optional(),
})

// Ingredient modification schema (No, Lite, On Side, Extra, Swap)
const ingredientModificationSchema = z.object({
  ingredientId: z.string(),
  name: z.string(),
  modificationType: z.enum(['no', 'lite', 'on_side', 'extra', 'swap']),
  priceAdjustment: nonNegativeNumber.default(0),
  swappedTo: z.object({
    modifierId: z.string(),
    name: z.string(),
    price: nonNegativeNumber,
  }).optional(),
})

// Pizza config schema for order items
const pizzaConfigSchema = z.object({
  sizeId: z.string(),
  crustId: z.string(),
  sauceId: z.string().nullable(),
  cheeseId: z.string().nullable(),
  sauceAmount: z.enum(['none', 'light', 'regular', 'extra']),
  cheeseAmount: z.enum(['none', 'light', 'regular', 'extra']),
  sauces: z.array(z.object({
    sauceId: z.string(),
    name: z.string(),
    sections: z.array(z.number()).default([]),
    amount: z.enum(['none', 'light', 'regular', 'extra']),
    price: z.number(),
  })).optional(),
  cheeses: z.array(z.object({
    cheeseId: z.string(),
    name: z.string(),
    sections: z.array(z.number()).default([]),
    amount: z.enum(['none', 'light', 'regular', 'extra']),
    price: z.number(),
  })).optional(),
  toppings: z.array(z.object({
    toppingId: z.string(),
    name: z.string(),
    sections: z.array(z.number()).default([]),
    amount: z.enum(['light', 'regular', 'extra']),
    price: z.number(),
    basePrice: z.number().default(0),
  })),
  cookingInstructions: z.string().optional(),
  cutStyle: z.string().optional(),
  specialNotes: z.string().optional(),
  totalPrice: z.number(),
  priceBreakdown: z.object({
    sizePrice: z.number(),
    crustPrice: z.number(),
    saucePrice: z.number(),
    cheesePrice: z.number(),
    toppingsPrice: z.number(),
  }),
}).optional()

const orderItemSchema = z.object({
  menuItemId: idSchema,
  name: z.string().min(1),
  price: nonNegativeNumber,
  quantity: z.number().int().positive().max(9999),
  correlationId: z.string().optional(), // Client-provided ID for matching response items
  modifiers: z.array(orderItemModifierSchema).default([]),
  ingredientModifications: z.array(ingredientModificationSchema).optional(),
  specialNotes: z.string().max(500).nullish(),
  seatNumber: z.number().int().positive().nullish(),
  courseNumber: z.number().int().positive().nullish(),
  isHeld: z.boolean().optional(),
  delayMinutes: z.number().int().positive().nullish(),
  pizzaConfig: pizzaConfigSchema,
  // Timed rental / entertainment fields
  blockTimeMinutes: z.number().int().positive().nullish(),
  // Pour size (liquor)
  pourSize: z.enum(['shot', 'double', 'tall', 'short']).nullish(),
  pourMultiplier: z.number().positive().nullish(),
  // Weight-based pricing
  soldByWeight: z.boolean().optional(),
  weight: z.number().positive().optional(),       // NET weight (post-tare)
  weightUnit: z.enum(['lb', 'kg', 'oz', 'g']).optional(),
  unitPrice: z.number().positive().optional(),     // Price per weight unit
  grossWeight: z.number().positive().optional(),   // Weight before tare
  tareWeight: z.number().nonnegative().optional(), // Container weight
})

export const createOrderSchema = z.object({
  employeeId: idSchema,
  locationId: idSchema,
  orderType: z.string(), // Allow custom order type slugs (not just enum)
  orderTypeId: idSchema.nullish(), // Reference to OrderType record (null from Android/Moshi)
  tableId: idSchema.nullish(),
  tabName: z.string().max(50).nullish(),
  guestCount: z.number().int().positive().nullish().default(1),
  items: z.array(orderItemSchema).max(500, 'Order cannot exceed 500 items').default([]),  // Empty = draft shell (no items yet)
  notes: z.string().max(500).nullish(),
  customFields: z.record(z.string(), z.string()).optional(), // Custom fields for configurable order types
  idempotencyKey: z.string().max(128).nullish(), // Client-generated UUID to prevent double-tap duplicates
  scheduledFor: z.string().nullish(), // ISO datetime for pre-orders / future orders
})

// ============================================
// Tab schemas
// ============================================

export const createTabSchema = z.object({
  employeeId: idSchema,
  tabName: z.string().max(50).optional(),
  preAuth: z.object({
    cardBrand: z.string(),
    cardLast4: z.string().regex(/^\d{4}$/),
    amount: positiveNumber.optional(),
  }).optional(),
})

// ============================================
// Inventory schemas
// ============================================

export const inventoryTransactionTypeSchema = z.enum([
  'sale',
  'purchase',
  'adjustment',
  'waste',
  'transfer',
  'count',
])

export const createInventoryTransactionSchema = z.object({
  locationId: idSchema,
  menuItemId: idSchema,
  type: inventoryTransactionTypeSchema,
  quantityChange: z.number().int(),
  reason: z.string().max(200).optional(),
  vendorName: z.string().max(100).optional(),
  invoiceNumber: z.string().max(50).optional(),
  unitCost: nonNegativeNumber.optional(),
  employeeId: idSchema.optional(),
})

// ============================================
// Inventory Report schemas
// ============================================

export const reportDateRangeSchema = z.object({
  locationId: idSchema,
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid start date format',
  }),
  endDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid end date format',
  }),
  department: z.string().optional(),
  category: z.string().optional(),
  categoryId: idSchema.optional(),
})

export const theoreticalUsageQuerySchema = reportDateRangeSchema.pick({
  locationId: true,
  startDate: true,
  endDate: true,
  department: true,
})

export const varianceQuerySchema = reportDateRangeSchema

export const pmixQuerySchema = reportDateRangeSchema.pick({
  locationId: true,
  startDate: true,
  endDate: true,
  department: true,
  categoryId: true,
})

// ============================================
// Recipe & Modifier Link schemas
// ============================================

const recipeIngredientSchema = z.object({
  inventoryItemId: idSchema.optional(),
  prepItemId: idSchema.optional(),
  quantity: positiveNumber,
  unit: z.string().min(1, 'Unit is required'),
}).refine(
  (data) => data.inventoryItemId || data.prepItemId,
  { message: 'Either inventoryItemId or prepItemId must be provided' }
)

export const createMenuItemRecipeSchema = z.object({
  portionSize: positiveNumber.optional(),
  portionUnit: z.string().optional(),
  prepInstructions: z.string().optional(),
  ingredients: z.array(recipeIngredientSchema).optional(),
})

export const createModifierInventoryLinkSchema = z.object({
  inventoryItemId: idSchema,
  usageQuantity: positiveNumber,
  usageUnit: z.string().min(1, 'Usage unit is required'),
})

// ============================================
// Datacap / Payment schemas
// ============================================

export const datacapSaleSchema = z.object({
  locationId: idSchema,
  readerId: idSchema,
  invoiceNo: z.string().min(1, 'Invoice number is required'),
  amount: z.number().positive('Amount must be positive').max(999999, 'Amount exceeds maximum'),
  tipAmount: z.number().nonnegative().nullish(),
  tipMode: z.enum(['suggestive', 'prompt', 'included', 'none']).optional(),
  tipSuggestions: z.array(z.number().nonnegative()).optional(),
  employeeId: idSchema,
  orderId: z.string().optional(),
  terminalId: z.string().optional(),
  customerCode: z.string().max(100).optional(),
  taxAmount: z.number().nonnegative().optional(),
})

export const datacapReturnSchema = z.object({
  locationId: idSchema,
  readerId: idSchema,
  recordNo: z.string().optional(),
  amount: z.number().positive('Refund amount must be positive').max(999999),
  cardPresent: z.boolean(),
  employeeId: idSchema,
  invoiceNo: z.string().optional(),
})

export const adjustTipSchema = z.object({
  paymentId: idSchema,
  newTipAmount: z.number().nonnegative('Tip amount cannot be negative').max(999999),
  reason: z.string().min(1, 'Reason is required').max(500),
  managerId: idSchema,
})

export const paymentSyncSchema = z.object({
  intentId: z.string().optional(),
  orderId: z.string().optional(),
  localOrderId: z.string().optional(),
  amount: z.number().positive('Amount must be positive'),
  tipAmount: z.number().nonnegative().default(0),
  paymentMethod: z.string().min(1),
  cardToken: z.string().nullish(),
  cardBrand: z.string().nullish(),
  cardLast4: z.string().nullish(),
  gatewayTransactionId: z.string().nullish(),
  authorizationCode: z.string().nullish(),
  isOfflineCapture: z.boolean().optional(),
  offlineCapturedAt: z.string().nullish(),
  terminalId: z.string().nullish(),
  employeeId: idSchema,
})

export const paymentReconcileSchema = z.object({
  paymentIds: z.array(idSchema).min(1, 'At least one payment ID is required'),
  reconciledBy: z.string().optional(),
})

// ============================================
// Order update schemas
// ============================================

export const updateOrderSchema = z.object({
  tabName: z.string().max(50).nullish(),
  guestCount: z.number().int().positive().nullish(),
  notes: z.string().max(500).nullish(),
  tipTotal: z.number().nonnegative().nullish(),
  tableId: z.string().nullish(),
  orderTypeId: z.string().nullish(),
  customerId: z.string().nullish(),
  status: z.string().optional(),
  employeeId: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
  isTaxExempt: z.boolean().optional(),
  fulfillmentMode: z.string().nullish(),
}).passthrough() // Allow extra fields like pagerNumber (which is logged+ignored)

export const applyDiscountSchema = z.object({
  discountRuleId: z.string().optional(),
  type: z.enum(['percent', 'fixed']).optional(),
  value: z.number().nonnegative().optional(),
  name: z.string().max(200).optional(),
  reason: z.string().max(500).optional(),
  employeeId: z.string().optional(),
  approvedById: z.string().optional(),
})

export const compVoidSchema = z.object({
  action: z.enum(['comp', 'void']),
  itemId: idSchema,
  reason: z.string().min(1, 'Reason is required').max(500),
  employeeId: idSchema,
  wasMade: z.boolean().optional(),
  approvedById: z.string().optional(),
  managerPinHash: z.string().optional(),
  remoteApprovalCode: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
})

// ============================================
// Auth schemas
// ============================================

export const loginSchema = z.object({
  pin: z.string().min(4, 'PIN must be at least 4 digits').max(6),
  locationId: z.string().optional(),
})

export const verifyManagerPinSchema = z.object({
  pin: z.string().min(4, 'PIN must be 4-6 digits').max(6),
  action: z.string().min(1, 'Action is required'),
  locationId: idSchema,
})

// ============================================
// Gift card schemas
// ============================================

export const createGiftCardSchema = z.object({
  amount: z.number().positive('Amount must be positive').max(99999),
  recipientName: z.string().max(100).nullish(),
  recipientEmail: z.string().email().nullish().or(z.literal('')),
  recipientPhone: z.string().max(20).nullish(),
  purchaserName: z.string().max(100).nullish(),
  message: z.string().max(500).nullish(),
  orderId: z.string().optional(),
  expiresAt: z.string().nullish(),
  skipPaymentCheck: z.boolean().optional(),
})

// ============================================
// Customer schemas
// ============================================

export const createCustomerSchema = z.object({
  locationId: idSchema,
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  displayName: z.string().max(100).nullish(),
  email: z.string().email().nullish().or(z.literal('')).or(z.literal(null)),
  phone: z.string().max(20).nullish(),
  notes: z.string().max(1000).nullish(),
  allergies: z.string().max(500).nullish(),
  favoriteDrink: z.string().max(200).nullish(),
  favoriteFood: z.string().max(200).nullish(),
  tags: z.array(z.string()).optional(),
  marketingOptIn: z.boolean().optional(),
  birthday: z.string().nullish(),
  requestingEmployeeId: z.string().optional(),
})

// ============================================
// Helper function for API routes
// ============================================

export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  const errorMessage = result.error.issues
    .map(e => `${e.path.join('.')}: ${e.message}`)
    .join(', ')
  return { success: false, error: errorMessage }
}
