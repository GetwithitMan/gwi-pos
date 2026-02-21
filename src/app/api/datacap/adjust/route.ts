import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

interface AdjustRequest {
  locationId: string
  readerId: string
  recordNo: string
  purchaseAmount: number
  gratuityAmount: number
  employeeId: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<AdjustRequest>(request)
    const { locationId, readerId, recordNo, purchaseAmount, gratuityAmount, employeeId } = body

    if (!locationId || !readerId || !recordNo || purchaseAmount === undefined || gratuityAmount === undefined) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, recordNo, purchaseAmount, gratuityAmount' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return Response.json({ error: auth.error }, { status: auth.status ?? 403 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.adjustGratuity(readerId, {
      recordNo,
      purchaseAmount,
      gratuityAmount,
    })

    const error = parseError(response)

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        adjustedAmount: response.authorize,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
