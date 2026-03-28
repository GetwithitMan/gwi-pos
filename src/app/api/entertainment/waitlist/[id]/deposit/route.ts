import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate, dispatchEntertainmentWaitlistNotify } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('entertainment-waitlist-deposit')

// POST - Collect a deposit for a waitlist entry
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, method, amount, employeeId, readerId } = body

    // Validate required fields
    if (!locationId) {
      return err('locationId is required')
    }

    if (!method || !['cash', 'card'].includes(method)) {
      return err('method must be "cash" or "card"')
    }

    if (!amount || amount <= 0) {
      return err('amount must be a positive number')
    }

    if (!employeeId) {
      return err('employeeId is required')
    }

    if (method === 'card' && !readerId) {
      return err('readerId is required for card deposits')
    }

    // Fetch the waitlist entry
    const entry = await db.entertainmentWaitlist.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        customerName: true,
        partySize: true,
        status: true,
        depositStatus: true,
        elementId: true,
        element: {
          select: { name: true, visualType: true },
        },
      },
    })

    if (!entry) {
      return notFound('Waitlist entry not found')
    }

    if (entry.locationId !== locationId) {
      return forbidden('Waitlist entry does not belong to this location')
    }

    if (entry.depositStatus === 'collected') {
      return err('Deposit already collected for this entry')
    }

    if (entry.status !== 'waiting' && entry.status !== 'notified') {
      return err('Can only collect deposit for waiting or notified entries')
    }

    // Process deposit based on method
    if (method === 'cash') {
      // Cash deposit: simply record it
      await db.entertainmentWaitlist.update({
        where: { id },
        data: {
          depositAmount: amount,
          depositMethod: 'cash',
          depositStatus: 'collected',
          depositCollectedBy: employeeId,
          lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
        },
      })

      pushUpstream()

      // Emit socket event (fire-and-forget)
      const elementName = entry.element?.name || entry.element?.visualType || null
      void dispatchEntertainmentWaitlistNotify(locationId, {
        entryId: id,
        customerName: entry.customerName,
        elementId: entry.elementId,
        elementName,
        partySize: entry.partySize,
        action: 'deposit-collected',
        message: `Cash deposit of $${amount.toFixed(2)} collected for ${entry.customerName || 'customer'}`,
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

      void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

      return ok({
          entryId: id,
          depositAmount: amount,
          depositMethod: 'cash',
          depositStatus: 'collected',
        })
    }

    // Card deposit: pre-auth via Datacap
    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const invoiceNo = `WL-${id.slice(-8)}`
    const response = await client.preAuth(readerId, {
      invoiceNo,
      amount,
      requestRecordNo: true,
    })

    const error = parseError(response)
    if (error) {
      return err('Card pre-auth failed', 402, { code: error.code, message: error.text, isRetryable: error.isRetryable })
    }

    // Record the card deposit on the waitlist entry
    await db.entertainmentWaitlist.update({
      where: { id },
      data: {
        depositAmount: amount,
        depositMethod: 'card',
        depositRecordNo: response.recordNo || null,
        depositCardLast4: response.cardLast4 || null,
        depositCardBrand: response.cardType || null,
        depositStatus: 'collected',
        depositCollectedBy: employeeId,
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
    })

    pushUpstream()

    // Emit socket event (fire-and-forget)
    const elementName = entry.element?.name || entry.element?.visualType || null
    void dispatchEntertainmentWaitlistNotify(locationId, {
      entryId: id,
      customerName: entry.customerName,
      elementId: entry.elementId,
      elementName,
      partySize: entry.partySize,
      action: 'deposit-collected',
      message: `Card deposit of $${amount.toFixed(2)} collected for ${entry.customerName || 'customer'}`,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
        entryId: id,
        depositAmount: amount,
        depositMethod: 'card',
        depositStatus: 'collected',
        depositRecordNo: response.recordNo || null,
        depositCardLast4: response.cardLast4 || null,
        depositCardBrand: response.cardType || null,
        authCode: response.authCode || null,
      })
  } catch (err) {
    console.error('Failed to collect waitlist deposit:', err)
    const message = err instanceof Error ? err.message : 'Failed to collect deposit'
    return err(message, 500)
  }
}))

// DELETE - Refund a deposit for a waitlist entry
export const DELETE = withVenue(withAuth(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    // Fetch the waitlist entry
    const entry = await db.entertainmentWaitlist.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        customerName: true,
        partySize: true,
        depositAmount: true,
        depositMethod: true,
        depositRecordNo: true,
        depositStatus: true,
        elementId: true,
        element: {
          select: { name: true, visualType: true },
        },
      },
    })

    if (!entry) {
      return notFound('Waitlist entry not found')
    }

    if (entry.locationId !== locationId) {
      return forbidden('Waitlist entry does not belong to this location')
    }

    if (entry.depositStatus !== 'collected') {
      return err(`Cannot refund deposit with status "${entry.depositStatus || 'none'}"`)
    }

    // For card deposits, void the pre-auth using the stored recordNo
    if (entry.depositMethod === 'card' && entry.depositRecordNo) {
      // Find an active reader for this location
      const reader = await db.paymentReader.findFirst({
        where: { locationId, deletedAt: null, isActive: true },
        select: { id: true },
      })

      if (!reader) {
        return err('No active payment reader found to process card refund', 503)
      }

      const client = await requireDatacapClient(locationId)
      const voidResponse = await client.voidSale(reader.id, {
        recordNo: entry.depositRecordNo,
      })

      const voidError = parseError(voidResponse)
      if (voidError) {
        return err('Failed to void card deposit', 502, { code: voidError.code, message: voidError.text, isRetryable: voidError.isRetryable })
      }
    }

    // Mark deposit as refunded
    await db.entertainmentWaitlist.update({
      where: { id },
      data: {
        depositStatus: 'refunded',
        depositRefundedAt: new Date(),
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
    })

    pushUpstream()

    // Emit socket event (fire-and-forget)
    const elementName = entry.element?.name || entry.element?.visualType || null
    const refundAmount = entry.depositAmount ? Number(entry.depositAmount) : 0
    void dispatchEntertainmentWaitlistNotify(locationId, {
      entryId: id,
      customerName: entry.customerName,
      elementId: entry.elementId,
      elementName,
      partySize: entry.partySize,
      action: 'deposit-refunded',
      message: `${entry.depositMethod === 'card' ? 'Card' : 'Cash'} deposit of $${refundAmount.toFixed(2)} refunded for ${entry.customerName || 'customer'}`,
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
        entryId: id,
        depositAmount: refundAmount,
        depositMethod: entry.depositMethod,
        depositStatus: 'refunded',
        depositRefundedAt: new Date().toISOString(),
      })
  } catch (err) {
    console.error('Failed to refund waitlist deposit:', err)
    const message = err instanceof Error ? err.message : 'Failed to refund deposit'
    return err(message, 500)
  }
}))
