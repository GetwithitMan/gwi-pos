/**
 * Events ↔ Financial Bridge
 *
 * Connects events with ticket sales and gift card redemption.
 */

export interface EventsToFinancialBridge {
  /** Apply discount to ticket purchase */
  applyEventDiscount(eventId: string, discountCode: string): Promise<{
    valid: boolean
    discountAmount: number
  }>

  /** Process gift card for ticket purchase */
  redeemGiftCardForTicket(cardNumber: string, amount: number): Promise<boolean>
}

export interface FinancialToEventsBridge {
  /** Get gift cards sold for an event */
  getGiftCardsSoldForEvent(eventId: string): Promise<number>
}

export const eventsToFinancialBridge: EventsToFinancialBridge = {
  applyEventDiscount: async () => ({ valid: true, discountAmount: 0 }),
  redeemGiftCardForTicket: async () => true,
}

export const financialToEventsBridge: FinancialToEventsBridge = {
  getGiftCardsSoldForEvent: async () => 0,
}
