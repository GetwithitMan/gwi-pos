import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

interface AuthOnlyRequest {
  locationId: string
  readerId: string
  invoiceNo: string
  employeeId?: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<AuthOnlyRequest>(request)
    const { locationId, readerId, invoiceNo, employeeId } = body

    if (!locationId || !readerId || !invoiceNo) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, invoiceNo' }, { status: 400 })
    }

    // BUG #472 FIX: Enforce permission check on monetary endpoint
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return Response.json({ error: auth.error }, { status: auth.status ?? 403 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.authOnly(readerId, { invoiceNo })
    const error = parseError(response)

    return Response.json({
      data: {
        approved: response.cmdStatus === 'Approved',
        authCode: response.authCode,
        recordNo: response.recordNo,        // Token for future use
        cardType: response.cardType,
        cardLast4: response.cardLast4,
        cardholderName: response.cardholderName,
        entryMethod: response.entryMethod,
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
