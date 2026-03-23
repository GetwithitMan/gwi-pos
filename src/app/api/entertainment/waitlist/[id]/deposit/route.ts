import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate, dispatchEntertainmentWaitlistNotify } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withAuth } from '@/lib/api-auth-middleware'

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
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    if (!method || !['cash', 'card'].includes(method)) {
      return NextResponse.json({ error: 'method must be "cash" or "card"' }, { status: 400 })
    }

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
    }

    if (!employeeId) {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
    }

    if (method === 'card' && !readerId) {
      return NextResponse.json({ error: 'readerId is required for card deposits' }, { status: 400 })
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
      return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
    }

    if (entry.locationId !== locationId) {
      return NextResponse.json({ error: 'Waitlist entry does not belong to this location' }, { status: 403 })
    }

    if (entry.depositStatus === 'collected') {
      return NextResponse.json({ error: 'Deposit already collected for this entry' }, { status: 400 })
    }

    if (entry.status !== 'waiting' && entry.status !== 'notified') {
      return NextResponse.json({ error: 'Can only collect deposit for waiting or notified entries' }, { status: 400 })
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
        },
      })

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
      }, { async: true }).catch(console.error)

      void dispatchFloorPlanUpdate(locationId, { async: true }).catch(console.error)

      return NextResponse.json({
        data: {
          entryId: id,
          depositAmount: amount,
          depositMethod: 'cash',
          depositStatus: 'collected',
        },
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
      return NextResponse.json({
        error: 'Card pre-auth failed',
        details: { code: error.code, message: error.text, isRetryable: error.isRetryable },
      }, { status: 402 })
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
      },
    })

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
    }, { async: true }).catch(console.error)

    void dispatchFloorPlanUpdate(locationId, { async: true }).catch(console.error)

    return NextResponse.json({
      data: {
        entryId: id,
        depositAmount: amount,
        depositMethod: 'card',
        depositStatus: 'collected',
        depositRecordNo: response.recordNo || null,
        depositCardLast4: response.cardLast4 || null,
        depositCardBrand: response.cardType || null,
        authCode: response.authCode || null,
      },
    })
  } catch (err) {
    console.error('Failed to collect waitlist deposit:', err)
    const message = err instanceof Error ? err.message : 'Failed to collect deposit'
    return NextResponse.json({ error: message }, { status: 500 })
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
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
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
      return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
    }

    if (entry.locationId !== locationId) {
      return NextResponse.json({ error: 'Waitlist entry does not belong to this location' }, { status: 403 })
    }

    if (entry.depositStatus !== 'collected') {
      return NextResponse.json(
        { error: `Cannot refund deposit with status "${entry.depositStatus || 'none'}"` },
        { status: 400 }
      )
    }

    // For card deposits, void the pre-auth using the stored recordNo
    if (entry.depositMethod === 'card' && entry.depositRecordNo) {
      // Find an active reader for this location
      const reader = await db.paymentReader.findFirst({
        where: { locationId, deletedAt: null, isActive: true },
        select: { id: true },
      })

      if (!reader) {
        return NextResponse.json(
          { error: 'No active payment reader found to process card refund' },
          { status: 503 }
        )
      }

      const client = await requireDatacapClient(locationId)
      const voidResponse = await client.voidSale(reader.id, {
        recordNo: entry.depositRecordNo,
      })

      const voidError = parseError(voidResponse)
      if (voidError) {
        return NextResponse.json({
          error: 'Failed to void card deposit',
          details: { code: voidError.code, message: voidError.text, isRetryable: voidError.isRetryable },
        }, { status: 502 })
      }
    }

    // Mark deposit as refunded
    await db.entertainmentWaitlist.update({
      where: { id },
      data: {
        depositStatus: 'refunded',
        depositRefundedAt: new Date(),
      },
    })

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
    }, { async: true }).catch(console.error)

    void dispatchFloorPlanUpdate(locationId, { async: true }).catch(console.error)

    return NextResponse.json({
      data: {
        entryId: id,
        depositAmount: refundAmount,
        depositMethod: entry.depositMethod,
        depositStatus: 'refunded',
        depositRefundedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('Failed to refund waitlist deposit:', err)
    const message = err instanceof Error ? err.message : 'Failed to refund deposit'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}))
