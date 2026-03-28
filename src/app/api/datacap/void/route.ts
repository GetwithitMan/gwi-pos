import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { err, ok } from '@/lib/api-response'

interface VoidRequest {
  locationId: string
  readerId: string
  recordNo: string
  employeeId: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<VoidRequest>(request)
    const { locationId, readerId, recordNo, employeeId } = body

    if (!locationId || !readerId || !recordNo) {
      return err('Missing required fields: locationId, readerId, recordNo')
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return err(auth.error, auth.status ?? 403)
    }

    const alreadyVoided = await db.payment.findFirst({
      where: {
        datacapRecordNo: recordNo,
        locationId,
        status: 'voided',
        deletedAt: null,
      },
      select: { id: true },
    })
    if (alreadyVoided) {
      return ok({ approved: true, isDuplicate: true, sequenceNo: null, error: null })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.voidSale(readerId, { recordNo })

    const error = parseError(response)

    return ok({
        approved: response.cmdStatus === 'Approved',
        sequenceNo: response.sequenceNo,
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
