/**
 * Order Response Mapper
 *
 * Maps Prisma DB results to clean API response shapes.
 * These functions intentionally accept `any` for the DB input because Prisma
 * returns complex intersection types with Decimal fields that vary based on
 * the `include`/`select` used in each query. The output shapes are well-typed.
 */

/** Mapped order item shape returned by the API */
export interface MappedOrderItem {
  id: string
  correlationId?: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  itemTotal: number
  seatNumber: number | null
  courseNumber: number | null
  courseStatus: string | null
  sentAt: Date | null
  kitchenStatus: string | null
  isHeld: boolean
  delayMinutes: number | null
  delayStartedAt: Date | null
  isCompleted: boolean
  completedAt: Date | null
  resendCount: number
  lastResentAt: Date | null
  resendNote: string | null
  status: string
  voidReason: string | null
  wasMade: boolean | null
  specialNotes: string | null
  modifiers: MappedModifier[]
  pizzaConfig: MappedPizzaConfig | null
  blockTimeMinutes: number | null
  blockTimeStartedAt: Date | null
  blockTimeExpiresAt: Date | null
  ingredientModifications: MappedIngredientMod[]
  createdAt: Date
}

interface MappedModifier {
  id: string
  modifierId: string | null
  name: string
  price: number
  quantity: number
  preModifier: string | null
  depth: number
  spiritTier: string | null
  linkedBottleProductId: string | null
}

interface MappedIngredientMod {
  id: string
  ingredientId: string
  ingredientName: string
  modificationType: string
  priceAdjustment: number
  swappedToModifierId: string | null
  swappedToModifierName: string | null
}

interface MappedPizzaConfig {
  sizeId: string
  crustId: string
  sauceId: string | null
  cheeseId: string | null
  sauceAmount: string
  cheeseAmount: string
  toppings: unknown[]
  sauces?: unknown[]
  cheeses?: unknown[]
  cookingInstructions: string | null
  cutStyle: string | null
  totalPrice: number
  priceBreakdown: {
    sizePrice: number
    crustPrice: number
    saucePrice: number
    cheesePrice: number
    toppingsPrice: number
  }
}

/**
 * Maps database OrderItem with modifiers to API response format.
 * Ensures ALL modifier fields are included in responses.
 *
 * @param item - Database OrderItem record (Prisma result with includes)
 * @param correlationId - Optional correlation ID to echo back for client-side tracking
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapOrderItemForResponse(item: any, correlationId?: string): MappedOrderItem {
  return {
    id: item.id,
    correlationId: correlationId,  // ✅ FIX-003: Echo back if provided
    menuItemId: item.menuItemId,
    name: item.name,
    price: Number(item.price),
    quantity: item.quantity,
    itemTotal: Number(item.itemTotal),
    seatNumber: item.seatNumber,
    courseNumber: item.courseNumber,
    courseStatus: item.courseStatus,
    sentAt: item.sentAt,
    kitchenStatus: item.kitchenStatus,
    isHeld: item.isHeld,
    delayMinutes: item.delayMinutes ?? null,
    delayStartedAt: item.delayStartedAt ?? null,
    isCompleted: item.isCompleted,
    completedAt: item.completedAt,
    resendCount: item.resendCount,
    lastResentAt: item.lastResentAt,
    resendNote: item.resendNote,
    status: item.status,
    voidReason: item.voidReason || null,
    wasMade: item.wasMade ?? null,
    specialNotes: item.specialNotes,
    modifiers: item.modifiers?.map((mod: Record<string, unknown>) => ({
      id: mod.id,
      modifierId: mod.modifierId,
      name: mod.name,
      price: Number(mod.price),
      quantity: mod.quantity,
      preModifier: mod.preModifier,       // ✅ Include
      depth: (mod.depth as number) ?? 0,  // ✅ Include
      spiritTier: mod.spiritTier,         // ✅ Include
      linkedBottleProductId: mod.linkedBottleProductId,  // ✅ Include
      // NOTE: parentModifierId missing from schema - needs migration
      // parentModifierId: mod.parentModifierId,
    })) || [],
    pizzaConfig: item.pizzaData ? {
      sizeId: item.pizzaData.sizeId,
      crustId: item.pizzaData.crustId,
      sauceId: item.pizzaData.sauceId,
      cheeseId: item.pizzaData.cheeseId,
      sauceAmount: item.pizzaData.sauceAmount,
      cheeseAmount: item.pizzaData.cheeseAmount,
      toppings: (item.pizzaData.toppingsData as { toppings?: unknown[] })?.toppings || [],
      sauces: (item.pizzaData.toppingsData as { sauces?: unknown[] })?.sauces,
      cheeses: (item.pizzaData.toppingsData as { cheeses?: unknown[] })?.cheeses,
      cookingInstructions: item.pizzaData.cookingInstructions,
      cutStyle: item.pizzaData.cutStyle,
      totalPrice: Number(item.pizzaData.totalPrice),
      priceBreakdown: {
        sizePrice: Number(item.pizzaData.sizePrice),
        crustPrice: Number(item.pizzaData.crustPrice),
        saucePrice: Number(item.pizzaData.saucePrice),
        cheesePrice: Number(item.pizzaData.cheesePrice),
        toppingsPrice: Number(item.pizzaData.toppingsPrice),
      },
    } : null,
    blockTimeMinutes: item.blockTimeMinutes,
    blockTimeStartedAt: item.blockTimeStartedAt,
    blockTimeExpiresAt: item.blockTimeExpiresAt,
    ingredientModifications: item.ingredientModifications?.map((ing: Record<string, unknown>) => ({
      id: ing.id,
      ingredientId: ing.ingredientId,
      ingredientName: ing.ingredientName,
      modificationType: ing.modificationType,
      priceAdjustment: Number(ing.priceAdjustment),
      swappedToModifierId: ing.swappedToModifierId,
      swappedToModifierName: ing.swappedToModifierName,
    })) || [],
    createdAt: item.createdAt,
  }
}

/** Mapped order shape returned by the API */
export interface MappedOrder {
  id: string
  orderNumber: number
  status: string
  orderType: string
  tableId: string | null
  tableName: string | null
  tabName: string | null
  guestCount: number
  customerId: string | null
  employeeId: string
  employee?: { id: string; name: string }
  items: MappedOrderItem[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  tipTotal: number
  total: number
  discounts: unknown[]
  payments: unknown[]
  notes: string | null
  createdAt: Date
  updatedAt: Date
  reopenedAt: Date | null
  reopenReason: string | null
  version: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapOrderForResponse(order: any): MappedOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    orderType: order.orderType,
    tableId: order.tableId,
    tableName: order.table?.name || null,
    tabName: order.tabName,
    guestCount: order.guestCount,
    customerId: order.customerId,
    employeeId: order.employeeId,
    employee: order.employee ? {
      id: order.employee.id,
      name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
    } : undefined,
    items: order.items?.map((item: unknown) => mapOrderItemForResponse(item)) || [],
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discountTotal),
    taxTotal: Number(order.taxTotal),
    tipTotal: Number(order.tipTotal),
    total: Number(order.total),
    discounts: order.discounts || [],
    payments: order.payments || [],
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    reopenedAt: order.reopenedAt || null,
    reopenReason: order.reopenReason || null,
    version: order.version ?? 1,
  }
}
