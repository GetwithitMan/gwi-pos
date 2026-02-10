/**
 * Datacap Payment Use Cases
 *
 * This layer sits between the POS UI and the DatacapClient transport layer.
 * It handles:
 * - Payment intent orchestration
 * - Business logic specific to POS operations
 * - Error handling and recovery
 * - Offline/online mode coordination
 *
 * The DatacapClient remains focused on XML/HTTP transport, while use cases
 * handle the complete payment workflows.
 */

import { DatacapClient } from './client'
import type { DatacapResponse, SaleParams, PreAuthParams, CaptureParams, VoidParams } from './types'
import { PaymentIntentManager } from '../payment-intent-manager'
import { logger } from '../logger'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProcessSaleParams {
  readerId: string
  orderId: string
  localOrderId?: string
  terminalId: string
  employeeId: string
  amounts: {
    purchase: number
    gratuity?: number
    tax?: number
  }
  invoiceNo: string
  tipMode?: 'suggestive' | 'prompt' | 'included' | 'none'
  tipSuggestions?: number[]
}

export interface OpenBarTabParams {
  readerId: string
  orderId: string
  terminalId: string
  employeeId: string
  preAuthAmount: number
  invoiceNo: string
}

export interface CloseBarTabParams {
  readerId: string
  intentId: string
  recordNo: string
  finalAmount: number
  gratuityAmount?: number
}

export interface VoidPaymentParams {
  readerId: string
  intentId: string
  recordNo: string
}

export interface SaleResult {
  success: boolean
  response?: DatacapResponse
  intentId: string
  error?: string
}

// ─── Sale Use Case ───────────────────────────────────────────────────────────

/**
 * Process a complete sale transaction with payment intent tracking
 *
 * Flow:
 * 1. Create payment intent (before any network call)
 * 2. Mark as authorizing
 * 3. Send EMVSale to Datacap
 * 4. Record authorization result
 * 5. Mark as captured (or offline capture if needed)
 *
 * @param client - Datacap client instance
 * @param params - Sale parameters
 * @returns Sale result with intent tracking
 */
export async function processSale(
  client: DatacapClient,
  params: ProcessSaleParams
): Promise<SaleResult> {
  const totalAmount = params.amounts.purchase + (params.amounts.gratuity || 0)

  // Step 1: Create intent BEFORE any network request
  const intent = await PaymentIntentManager.createIntent({
    orderId: params.orderId,
    localOrderId: params.localOrderId,
    terminalId: params.terminalId,
    employeeId: params.employeeId,
    amount: totalAmount,
    tipAmount: params.amounts.gratuity || 0,
    paymentMethod: 'card',
  })

  logger.debug('Processing sale with intent tracking', {
    intentId: intent.id,
    orderId: params.orderId,
    amount: totalAmount,
  })

  try {
    // Step 2: Mark as authorizing
    await PaymentIntentManager.markAuthorizing(intent.id)

    // Step 3: Send to Datacap
    const saleParams: SaleParams = {
      invoiceNo: params.invoiceNo,
      amounts: params.amounts,
      tipMode: params.tipMode,
      tipSuggestions: params.tipSuggestions,
      requestRecordNo: true,
      allowPartialAuth: true,
    }

    const response = await client.sale(params.readerId, saleParams)

    // Step 4: Record authorization result
    const isApproved = response.cmdStatus === 'Approved'
    await PaymentIntentManager.recordAuthorization(intent.id, {
      success: isApproved,
      transactionId: response.refNo,
      authCode: response.authCode,
      declineReason: isApproved ? undefined : response.textResponse,
    })

    // Step 5: Mark as captured if approved
    if (isApproved) {
      await PaymentIntentManager.recordCapture(intent.id)
      logger.debug('Sale completed successfully', {
        intentId: intent.id,
        authCode: response.authCode,
      })
    }

    return {
      success: isApproved,
      response,
      intentId: intent.id,
      error: isApproved ? undefined : response.textResponse,
    }
  } catch (error) {
    // Network error or other failure
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('payment', 'Sale failed', error, { intentId: intent.id })

    // Check if we should queue for offline capture or mark as failed
    if (isNetworkError(error)) {
      await PaymentIntentManager.markForOfflineCapture(intent.id)
      return {
        success: false,
        intentId: intent.id,
        error: 'Network error - queued for offline sync',
      }
    } else {
      await PaymentIntentManager.recordFailure(intent.id, errorMessage)
      return {
        success: false,
        intentId: intent.id,
        error: errorMessage,
      }
    }
  }
}

// ─── Bar Tab Use Cases ───────────────────────────────────────────────────────

/**
 * Open a bar tab with pre-authorization
 *
 * Flow:
 * 1. Create payment intent for pre-auth
 * 2. Send EMVPreAuth to Datacap
 * 3. Record authorization result with recordNo
 *
 * @param client - Datacap client instance
 * @param params - Bar tab parameters
 * @returns Sale result with recordNo for future capture
 */
export async function openBarTab(
  client: DatacapClient,
  params: OpenBarTabParams
): Promise<SaleResult> {
  // Create intent for pre-auth
  const intent = await PaymentIntentManager.createIntent({
    orderId: params.orderId,
    terminalId: params.terminalId,
    employeeId: params.employeeId,
    amount: params.preAuthAmount,
    tipAmount: 0,
    paymentMethod: 'card',
  })

  logger.debug('Opening bar tab with pre-auth', {
    intentId: intent.id,
    orderId: params.orderId,
    preAuthAmount: params.preAuthAmount,
  })

  try {
    await PaymentIntentManager.markAuthorizing(intent.id)

    const preAuthParams: PreAuthParams = {
      invoiceNo: params.invoiceNo,
      amount: params.preAuthAmount,
      requestRecordNo: true,
    }

    const response = await client.preAuth(params.readerId, preAuthParams)

    const isApproved = response.cmdStatus === 'Approved'
    await PaymentIntentManager.recordAuthorization(intent.id, {
      success: isApproved,
      transactionId: response.refNo,
      authCode: response.authCode,
      declineReason: isApproved ? undefined : response.textResponse,
    })

    if (isApproved) {
      logger.debug('Bar tab opened successfully', {
        intentId: intent.id,
        recordNo: response.recordNo,
      })
    }

    return {
      success: isApproved,
      response,
      intentId: intent.id,
      error: isApproved ? undefined : response.textResponse,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('payment', 'Pre-auth failed', error, { intentId: intent.id })

    await PaymentIntentManager.recordFailure(intent.id, errorMessage)
    return {
      success: false,
      intentId: intent.id,
      error: errorMessage,
    }
  }
}

/**
 * Close a bar tab by capturing the pre-authorization
 *
 * @param client - Datacap client instance
 * @param params - Close tab parameters with recordNo
 * @returns Sale result with capture confirmation
 */
export async function closeBarTab(
  client: DatacapClient,
  params: CloseBarTabParams
): Promise<SaleResult> {
  logger.debug('Closing bar tab', {
    intentId: params.intentId,
    recordNo: params.recordNo,
    finalAmount: params.finalAmount,
  })

  try {
    const captureParams: CaptureParams = {
      recordNo: params.recordNo,
      purchaseAmount: params.finalAmount,
      gratuityAmount: params.gratuityAmount,
    }

    const response = await client.preAuthCapture(params.readerId, captureParams)

    const isApproved = response.cmdStatus === 'Approved'

    if (isApproved) {
      await PaymentIntentManager.recordCapture(params.intentId)
      logger.debug('Bar tab closed successfully', {
        intentId: params.intentId,
      })
    } else {
      await PaymentIntentManager.recordFailure(params.intentId, response.textResponse)
    }

    return {
      success: isApproved,
      response,
      intentId: params.intentId,
      error: isApproved ? undefined : response.textResponse,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('payment', 'Capture failed', error, { intentId: params.intentId })

    if (isNetworkError(error)) {
      await PaymentIntentManager.markForOfflineCapture(params.intentId)
      return {
        success: false,
        intentId: params.intentId,
        error: 'Network error - queued for offline capture',
      }
    } else {
      await PaymentIntentManager.recordFailure(params.intentId, errorMessage)
      return {
        success: false,
        intentId: params.intentId,
        error: errorMessage,
      }
    }
  }
}

// ─── Void Use Case ───────────────────────────────────────────────────────────

/**
 * Void a payment and update intent status
 *
 * @param client - Datacap client instance
 * @param params - Void parameters
 * @returns Sale result with void confirmation
 */
export async function voidPayment(
  client: DatacapClient,
  params: VoidPaymentParams
): Promise<SaleResult> {
  logger.debug('Voiding payment', {
    intentId: params.intentId,
    recordNo: params.recordNo,
  })

  try {
    const voidParams: VoidParams = {
      recordNo: params.recordNo,
    }

    const response = await client.voidSale(params.readerId, voidParams)

    const isSuccess = response.cmdStatus === 'Success' || response.cmdStatus === 'Approved'

    if (isSuccess) {
      // Mark intent as voided (update to failed status with void message)
      await PaymentIntentManager.recordFailure(
        params.intentId,
        'Payment voided successfully'
      )
      logger.debug('Payment voided successfully', {
        intentId: params.intentId,
      })
    }

    return {
      success: isSuccess,
      response,
      intentId: params.intentId,
      error: isSuccess ? undefined : response.textResponse,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('payment', 'Void failed', error, { intentId: params.intentId })

    return {
      success: false,
      intentId: params.intentId,
      error: errorMessage,
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if error is a network error (should trigger offline capture)
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  // Check for Datacap network error codes
  const errorCode = (error as Error & { code?: string }).code
  return (
    errorCode === 'DATACAP_TIMEOUT' ||
    errorCode === 'DATACAP_CONNECTION_REFUSED' ||
    errorCode === 'DATACAP_NETWORK_UNREACHABLE' ||
    errorCode === 'DATACAP_NETWORK_ERROR'
  )
}
