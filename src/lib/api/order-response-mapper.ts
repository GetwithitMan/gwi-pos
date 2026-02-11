/**
 * Maps database OrderItem with modifiers to API response format.
 * Ensures ALL modifier fields are included in responses.
 *
 * @param item - Database OrderItem record
 * @param correlationId - Optional correlation ID to echo back for client-side tracking
 */
export function mapOrderItemForResponse(item: any, correlationId?: string) {
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
    modifiers: item.modifiers?.map((mod: any) => ({
      id: mod.id,
      modifierId: mod.modifierId,
      name: mod.name,
      price: Number(mod.price),
      quantity: mod.quantity,
      preModifier: mod.preModifier,       // ✅ Include
      depth: mod.depth ?? 0,               // ✅ Include
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
    ingredientModifications: item.ingredientModifications?.map((ing: any) => ({
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

export function mapOrderForResponse(order: any) {
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
    items: order.items?.map(mapOrderItemForResponse) || [],
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
  }
}
