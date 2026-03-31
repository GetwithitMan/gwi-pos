/**
 * Online Payment Processing
 *
 * Wraps Datacap PayAPI card + ACH payment flows for online checkout.
 * Handles decline/error with order soft-deletion.
 */

import { NextResponse } from 'next/server'
import { getPayApiClient, isPayApiSuccess, type PayApiAchResponse } from '@/lib/datacap/payapi-client'
import { err } from '@/lib/api-response'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('online-payment')

type PrismaClient = {
  order: {
    update: (args: any) => Promise<any>
  }
}

export interface OnlinePaymentInput {
  orderId: string
  orderNumber: number
  chargeAmount: number
  tip: number
  locationId: string
  employeeId: string
  // Card fields
  token?: string | null
  cardBrand?: string | null
  cardLast4?: string | null
  walletType?: 'apple_pay' | 'google_pay' | null
  // ACH fields
  isAchPayment: boolean
  achDetails?: {
    routingNumber: string
    accountNumber: string
    accountType: 'Checking' | 'Savings'
    accountHolderFirstName: string
    accountHolderLastName: string
  }
}

export interface OnlinePaymentResult {
  success: true
  payApiResult: any | null
  achResult: PayApiAchResponse | null
}

export interface OnlinePaymentFailure {
  success: false
  response: NextResponse
}

/**
 * Process an online payment via Datacap PayAPI (card or ACH).
 * On failure, soft-deletes the order and returns an error response.
 */
export async function processOnlinePayment(
  venueDb: PrismaClient,
  input: OnlinePaymentInput,
): Promise<OnlinePaymentResult | OnlinePaymentFailure> {
  const { orderId, orderNumber, chargeAmount, isAchPayment, achDetails, token } = input

  const softDeleteOrder = async () => {
    await venueDb.order.update({
      where: { id: orderId },
      data: { status: 'cancelled', deletedAt: new Date(), lastMutatedBy: 'cloud' },
    }).catch(e => log.warn({ err: e }, 'fire-and-forget failed in online.checkout'))
  }

  if (isAchPayment && achDetails) {
    // ── ACH payment flow ──
    let achResult: PayApiAchResponse
    try {
      achResult = await getPayApiClient().achAuthorize({
        routingNo:     achDetails.routingNumber,
        acctNo:        achDetails.accountNumber,
        acctType:      achDetails.accountType,
        amount:        chargeAmount.toFixed(2),
        invoiceNo:     orderNumber.toString(),
        custFirstName: achDetails.accountHolderFirstName,
        custLastName:  achDetails.accountHolderLastName,
        entryClass:    'Personal',
        standardEntryClassCode: 'WEB',
        singleOrRecurring: 'S',
      })
    } catch (payErr) {
      await softDeleteOrder()
      console.error('[checkout] PayAPI ACH error:', payErr)
      return {
        success: false,
        response: err('ACH payment processing failed. Please check your bank details and try again.', 502),
      }
    }

    if (!isPayApiSuccess(achResult.status)) {
      await softDeleteOrder()
      return {
        success: false,
        response: NextResponse.json(
          {
            error: 'ACH payment declined. Please check your bank details or try a different account.',
            declineMessage: achResult.message,
          },
          { status: 402 }
        ),
      }
    }

    return { success: true, payApiResult: null, achResult }
  }

  // ── Card payment flow ──
  if (!token) {
    await softDeleteOrder()
    return {
      success: false,
      response: err('Payment token is required for the remaining balance'),
    }
  }

  let payApiResult: any
  try {
    payApiResult = await getPayApiClient().sale({
      token,
      amount: chargeAmount.toFixed(2),
      invoiceNo: orderNumber.toString(),
    })
  } catch (payErr) {
    await softDeleteOrder()
    console.error('[checkout] PayAPI error:', payErr)
    return {
      success: false,
      response: err('Payment processing failed. Please try again.', 502),
    }
  }

  if (!isPayApiSuccess(payApiResult.status)) {
    await softDeleteOrder()
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Payment declined. Please try a different card.',
          declineMessage: payApiResult.message,
        },
        { status: 402 }
      ),
    }
  }

  return { success: true, payApiResult, achResult: null }
}
