/**
 * Order Management ↔ Financial Bridge
 *
 * Connects orders with discounts, gift cards, tax, and house accounts.
 */

export interface OrderToFinancialBridge {
  /** Apply discount to order */
  applyDiscount(orderId: string, discountId: string): Promise<{ success: boolean; amount: number }>

  /** Validate and redeem coupon */
  redeemCoupon(orderId: string, couponCode: string): Promise<{ valid: boolean; discountAmount: number; error?: string }>

  /** Check gift card balance */
  checkGiftCardBalance(cardNumber: string): Promise<{ balance: number; isActive: boolean }>

  /** Redeem gift card */
  redeemGiftCard(orderId: string, cardNumber: string, amount: number): Promise<boolean>

  /** Charge to house account */
  chargeHouseAccount(orderId: string, accountId: string, amount: number): Promise<boolean>

  /** Calculate tax for order */
  calculateTax(items: Array<{ categoryId: string; amount: number }>): Promise<number>

  /** Get applicable automatic discounts */
  getAutomaticDiscounts(orderTotal: number, itemIds: string[]): Promise<Array<{ id: string; name: string; amount: number }>>
}

export interface FinancialToOrderBridge {
  /** Get orders paid with specific gift card */
  getOrdersForGiftCard(cardId: string): Promise<string[]>

  /** Get orders on a house account */
  getOrdersForHouseAccount(accountId: string): Promise<string[]>
}

export const orderToFinancialBridge: OrderToFinancialBridge = {
  applyDiscount: async () => ({ success: true, amount: 0 }),
  redeemCoupon: async () => ({ valid: true, discountAmount: 0 }),
  checkGiftCardBalance: async () => ({ balance: 0, isActive: true }),
  redeemGiftCard: async () => true,
  chargeHouseAccount: async () => true,
  calculateTax: async () => 0,
  getAutomaticDiscounts: async () => [],
}

export const financialToOrderBridge: FinancialToOrderBridge = {
  getOrdersForGiftCard: async () => [],
  getOrdersForHouseAccount: async () => [],
}
