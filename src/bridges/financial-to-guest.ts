/**
 * Financial ↔ Guest Bridge
 *
 * Connects financial instruments with customer profiles.
 */

export interface FinancialToGuestBridge {
  /** Get customer for house account */
  getCustomerForHouseAccount(accountId: string): Promise<{
    id: string
    name: string
    email?: string
  } | null>

  /** Get customer's gift cards */
  getGiftCardsForCustomer(customerId: string): Promise<Array<{
    id: string
    number: string
    balance: number
  }>>

  /** Get customer's loyalty points */
  getLoyaltyPoints(customerId: string): Promise<number>

  /** Add loyalty points */
  addLoyaltyPoints(customerId: string, points: number, reason: string): Promise<boolean>
}

export interface GuestToFinancialBridge {
  /** Create house account for customer */
  createHouseAccount(customerId: string, creditLimit: number): Promise<string>

  /** Issue gift card to customer */
  issueGiftCard(customerId: string, amount: number): Promise<{
    id: string
    number: string
  }>
}

export const financialToGuestBridge: FinancialToGuestBridge = {
  getCustomerForHouseAccount: async () => null,
  getGiftCardsForCustomer: async () => [],
  getLoyaltyPoints: async () => 0,
  addLoyaltyPoints: async () => true,
}

export const guestToFinancialBridge: GuestToFinancialBridge = {
  createHouseAccount: async () => '',
  issueGiftCard: async () => ({ id: '', number: '' }),
}
