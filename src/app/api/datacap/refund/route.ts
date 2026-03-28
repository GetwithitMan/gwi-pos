import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { roundToCents } from '@/lib/pricing'
import { err, notFound, ok } from '@/lib/api-response'

interface RefundRequest {
  readerId: string
  recordNo: string
  invoiceNo: string
  amount: number
  employeeId?: string
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<RefundRequest>(request)
    const { readerId, recordNo, invoiceNo, employeeId } = body
    let { amount } = body

    if (!readerId || !recordNo || !invoiceNo || amount === undefined || amount === null) {
      return err('Missing required fields: readerId, recordNo, invoiceNo, amount')
    }

    if (amount <= 0) {
      return err('Refund amount must be positive')
    }

    amount = roundToCents(amount)

    // Look up reader to get its locationId for client config
    const { db } = await import('@/lib/db')
    const reader = await db.paymentReader.findFirst({
      where: { id: readerId, deletedAt: null },
      select: { id: true, locationId: true },
    })

    if (!reader) {
      return notFound('Payment reader not found')
    }

    // BUG #470 FIX: Require MGR_REFUNDS permission instead of basic card payment permission
    const auth = await requirePermission(employeeId, reader.locationId, PERMISSIONS.MGR_REFUNDS)
    if (!auth.authorized) {
      return err(auth.error, auth.status ?? 403)
    }

    // BUG #470 FIX: Cap refund amount — look up original payment by datacapRecordNo
    const originalPayment = await db.payment.findFirst({
      where: { datacapRecordNo: recordNo, locationId: reader.locationId, deletedAt: null },
      select: { id: true, amount: true, refundedAmount: true },
    })
    if (!originalPayment) {
      return notFound('Original payment not found for this recordNo')
    }
    const maxRefundable = Number(originalPayment.amount) - Number(originalPayment.refundedAmount || 0)
    if (amount > maxRefundable) {
      return err(`Refund amount $${amount.toFixed(2)} exceeds maximum refundable $${maxRefundable.toFixed(2)}`)
    }

    await validateReader(readerId, reader.locationId)
    const client = await requireDatacapClient(reader.locationId)

    // ReturnByRecordNo — card not present, uses stored token
    const response = await client.emvReturn(readerId, {
      recordNo,
      invoiceNo,
      amount,
      cardPresent: false,
    })

    const approved = response.cmdStatus === 'Approved'

    if (!approved) {
      return err(response.textResponse || 'Refund declined', 422)
    }

    return ok({
        approved,
        refNo: response.refNo ?? '',
        authCode: response.authCode ?? '',
        amount: response.authorize ? roundToCents(parseFloat(response.authorize)) : amount,
      })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
