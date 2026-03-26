import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

interface SAFForwardRequest {
  locationId: string
  readerId: string
}

/**
 * POST /api/datacap/saf/forward
 * Forward all offline-stored SAF transactions to the processor.
 * Datacap certification test 18.3
 *
 * CRITICAL — NO RE-AUTHORIZATION:
 * This route ONLY submits the already-approved SAF batch stored on the reader
 * to the payment processor. It does NOT create new authorizations or re-charge
 * any cards. The card approval already happened at the reader during the
 * original transaction (SAF mode). This call simply uploads that stored batch.
 *
 * The Datacap SAF_FORWARD_ALL tran code is an admin/batch operation — it tells
 * the reader to upload its stored offline transactions. No card data is sent,
 * no new auth is requested.
 *
 * After forwarding, we update all APPROVED_SAF_PENDING_UPLOAD Payment records
 * for this reader to UPLOAD_SUCCESS (or UPLOAD_FAILED on error).
 */
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<SAFForwardRequest>(request)
    const { locationId, readerId } = body

    if (!locationId || !readerId) {
      return Response.json({ error: 'Missing required fields: locationId, readerId' }, { status: 400 })
    }

    await validateReader(readerId, locationId)

    const alreadyUploaded = await db.payment.count({
      where: {
        paymentReaderId: readerId,
        safStatus: 'UPLOAD_SUCCESS',
        order: { locationId },
      },
    })
    if (alreadyUploaded > 0) {
      return Response.json(
        { error: `${alreadyUploaded} payment(s) for this reader already have safStatus=UPLOAD_SUCCESS. Manual review required to avoid double-submission.` },
        { status: 409 }
      )
    }

    const client = await requireDatacapClient(locationId)

    const response = await client.safForwardAll(readerId)
    const success = response.cmdStatus === 'Success'
    const safForwarded = parseInt(response.safForwarded || '0', 10)

    // Update Payment records: SAF_PENDING_UPLOAD → UPLOAD_SUCCESS or UPLOAD_FAILED
    // Only update payments that are still pending upload for this reader
    const newStatus = success ? 'UPLOAD_SUCCESS' : 'UPLOAD_FAILED'
    const updateData: Record<string, unknown> = {
      safStatus: newStatus,
      safUploadedAt: success ? new Date() : undefined,
      lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
    }
    if (!success) {
      updateData.safError = response.textResponse || response.cmdStatus || 'SAF forward failed'
    }

    const updated = await db.payment.updateMany({
      where: {
        paymentReaderId: readerId,
        safStatus: 'APPROVED_SAF_PENDING_UPLOAD',
        order: { locationId },
      },
      data: updateData,
    })

    logger.log('datacap', `SAF forward complete: ${safForwarded} forwarded, ${updated.count} payment records updated to ${newStatus}`, {
      readerId, locationId, safForwarded, updatedCount: updated.count, success,
    })

    pushUpstream()

    return Response.json({
      data: {
        success,
        safForwarded,
        paymentsUpdated: updated.count,
        newStatus,
        sequenceNo: response.sequenceNo,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
}))
