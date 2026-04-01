import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { roundToCents } from '@/lib/pricing'
import { db } from '@/lib/db'
import { err, notFound, ok } from '@/lib/api-response'

interface CaptureRequest {
  locationId: string
  readerId: string
  recordNo: string
  purchaseAmount: number
  gratuityAmount?: number
  employeeId: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<CaptureRequest>(request)
    const { locationId, readerId, recordNo, gratuityAmount, employeeId } = body
    let { purchaseAmount } = body

    if (!locationId || !readerId || !recordNo || purchaseAmount === undefined) {
      return err('Missing required fields: locationId, readerId, recordNo, purchaseAmount')
    }

    if (purchaseAmount <= 0) {
      return err('purchaseAmount must be positive')
    }
    if (gratuityAmount !== undefined && gratuityAmount < 0) {
      return err('gratuityAmount must be non-negative')
    }

    purchaseAmount = roundToCents(purchaseAmount)

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return err(auth.error, auth.status ?? 403)
    }

    const orderCard = await db.orderCard.findFirst({
      where: { recordNo, locationId, deletedAt: null },
      select: { authAmount: true, createdAt: true },
    })
    if (!orderCard) {
      return notFound('No pre-auth found for this recordNo')
    }
    if (purchaseAmount + (gratuityAmount || 0) > Number(orderCard.authAmount)) {
      return err(`Capture amount $${(purchaseAmount + (gratuityAmount || 0)).toFixed(2)} exceeds authorized amount $${Number(orderCard.authAmount).toFixed(2)}`)
    }

    // Pre-auth expiration check — Datacap pre-auths expire after ~7 days
    const PRE_AUTH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
    if (orderCard.createdAt) {
      const ageMs = Date.now() - new Date(orderCard.createdAt).getTime()
      if (ageMs > PRE_AUTH_MAX_AGE_MS) {
        const ageDays = Math.floor(ageMs / 86400000)
        return err(
          `Pre-authorization expired (${ageDays} days old). ` +
          'Datacap pre-auths are valid for ~7 days. Please run a new card.',
          409
        )
      }
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.preAuthCapture(readerId, {
      recordNo,
      purchaseAmount,
      gratuityAmount,
    })

    const error = parseError(response)

    return ok({
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        amountAuthorized: response.authorize,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
