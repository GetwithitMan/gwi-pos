/**
 * Payment Service - Client Layer
 *
 * Encapsulates all payment-related API calls and provides a clean interface
 * for components. Handles error transformation, retries, and caching.
 *
 * Benefits:
 * - Components focus on UI, not API logic
 * - Consistent error handling across the app
 * - Easier to mock for testing
 * - Request/response caching
 * - Centralized API endpoint management
 */

import { logger } from '../logger'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaymentRequest {
  orderId: string
  payments: PaymentInput[]
  employeeId: string
}

export interface PaymentInput {
  method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account'
  amount: number
  tipAmount?: number
  amountTendered?: number
  datacapRecordNo?: string
  datacapRefNumber?: string
  cardBrand?: string
  cardLast4?: string
  giftCardNumber?: string
  houseAccountId?: string
}

export interface PaymentResponse {
  success: boolean
  payments: ProcessedPayment[]
  order?: {
    id: string
    status: string
    total: number
  }
  error?: string
}

export interface ProcessedPayment {
  id: string
  method: string
  amount: number
  status: string
  cardLast4?: string
  error?: string
}

export interface VoidRequest {
  orderId: string
  itemIds?: string[]
  reason: string
  requireManagerApproval: boolean
  employeeId: string
  managerPin?: string
}

export interface VoidResponse {
  success: boolean
  voidedItems: string[]
  error?: string
}

export interface RemoteVoidApprovalRequest {
  orderId: string
  itemIds: string[]
  reason: string
  requestingEmployeeId: string
  managerId: string
}

export interface RemoteVoidApprovalResponse {
  success: boolean
  requestId: string
  approvalCode?: string
  error?: string
}

export interface GiftCardBalanceRequest {
  cardNumber: string
  locationId: string
}

export interface GiftCardBalanceResponse {
  success: boolean
  balance: number
  isActive: boolean
  cardNumber: string
  error?: string
}

export interface HouseAccount {
  id: string
  accountNumber: string
  customerName: string
  balance: number
  creditLimit: number
  isActive: boolean
}

export interface HouseAccountsResponse {
  success: boolean
  accounts: HouseAccount[]
  error?: string
}

// ─── Result Type Pattern ─────────────────────────────────────────────────────

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; statusCode?: number }

// ─── PaymentService Class ────────────────────────────────────────────────────

export class PaymentService {
  private baseUrl: string

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  }

  /**
   * Process payment(s) for an order
   */
  async processPayment(request: PaymentRequest): Promise<ServiceResult<PaymentResponse>> {
    try {
      logger.debug('Processing payment', {
        orderId: request.orderId,
        paymentCount: request.payments.length,
        employeeId: request.employeeId,
      })

      const response = await fetch(`${this.baseUrl}/api/orders/${request.orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments: request.payments,
          employeeId: request.employeeId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        logger.error('payment', 'Payment failed', undefined, {
          orderId: request.orderId,
          status: response.status,
          error: data.error,
        })

        return {
          success: false,
          error: data.error || 'Payment processing failed',
          statusCode: response.status,
        }
      }

      logger.debug('Payment successful', {
        orderId: request.orderId,
        paymentCount: data.payments?.length || 0,
      })

      return {
        success: true,
        data: data as PaymentResponse,
      }
    } catch (error) {
      logger.error('payment', 'Payment network error', error, {
        orderId: request.orderId,
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  /**
   * Void order items
   */
  async voidItems(request: VoidRequest): Promise<ServiceResult<VoidResponse>> {
    try {
      logger.debug('Voiding items', {
        orderId: request.orderId,
        itemCount: request.itemIds?.length || 0,
        reason: request.reason,
      })

      const response = await fetch(`${this.baseUrl}/api/orders/${request.orderId}/comp-void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'void',
          itemIds: request.itemIds,
          reason: request.reason,
          requireManagerApproval: request.requireManagerApproval,
          employeeId: request.employeeId,
          managerPin: request.managerPin,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Void failed',
          statusCode: response.status,
        }
      }

      return {
        success: true,
        data: data as VoidResponse,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  /**
   * Request remote void approval via SMS
   */
  async requestRemoteVoidApproval(
    request: RemoteVoidApprovalRequest
  ): Promise<ServiceResult<RemoteVoidApprovalResponse>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/voids/remote-approval/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Request failed',
          statusCode: response.status,
        }
      }

      return {
        success: true,
        data: data as RemoteVoidApprovalResponse,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  /**
   * Check gift card balance
   */
  async checkGiftCardBalance(
    request: GiftCardBalanceRequest
  ): Promise<ServiceResult<GiftCardBalanceResponse>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/gift-cards/balance?cardNumber=${encodeURIComponent(request.cardNumber)}&locationId=${request.locationId}`
      )

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Balance check failed',
          statusCode: response.status,
        }
      }

      return {
        success: true,
        data: data as GiftCardBalanceResponse,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  /**
   * Load house accounts for location
   */
  async loadHouseAccounts(locationId: string): Promise<ServiceResult<HouseAccountsResponse>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/house-accounts?locationId=${locationId}&active=true`
      )

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to load accounts',
          statusCode: response.status,
        }
      }

      return {
        success: true,
        data: {
          success: true,
          accounts: data.accounts || [],
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  /**
   * Fetch order details for payment
   */
  async fetchOrderForPayment(orderId: string): Promise<
    ServiceResult<{
      id: string
      total: number
      subtotal: number
      tax: number
      existingPayments: ProcessedPayment[]
    }>
  > {
    try {
      const response = await fetch(`${this.baseUrl}/api/orders/${orderId}`)
      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to fetch order',
          statusCode: response.status,
        }
      }

      return {
        success: true,
        data: {
          id: data.id,
          total: data.total,
          subtotal: data.subtotal,
          tax: data.tax,
          existingPayments: data.payments || [],
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  /**
   * Calculate split payment amounts
   */
  calculateSplitAmounts(total: number, ways: number): number[] {
    const baseAmount = Math.floor((total / ways) * 100) / 100
    const amounts = Array(ways).fill(baseAmount)

    // Adjust last payment to account for rounding
    const totalOfSplits = baseAmount * ways
    const remainder = Math.round((total - totalOfSplits) * 100) / 100
    amounts[amounts.length - 1] += remainder

    return amounts
  }

  /**
   * Calculate remaining balance after existing payments
   */
  calculateRemainingBalance(
    orderTotal: number,
    existingPayments: ProcessedPayment[]
  ): number {
    const paidAmount = existingPayments
      .filter((p) => p.status === 'completed')
      .reduce((sum, p) => sum + p.amount, 0)

    return Math.max(0, Math.round((orderTotal - paidAmount) * 100) / 100)
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

/**
 * Singleton instance of PaymentService
 * Use this for all payment operations in the app
 */
export const paymentService = new PaymentService()

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Check if a service result is successful and narrow the type
 */
export function isSuccessResult<T>(
  result: ServiceResult<T>
): result is { success: true; data: T } {
  return result.success === true
}

/**
 * Extract error message from service result
 */
export function getErrorMessage(result: ServiceResult<any>): string {
  return result.success ? '' : result.error
}
