/**
 * CFD Notify — Lightweight API route for Customer-Facing Display events
 *
 * Client-side socket.emit() does NOT broadcast to other clients.
 * This route accepts CFD event payloads and dispatches them server-side
 * via emitToLocation(), which properly broadcasts to all clients in the
 * location room (including the CFD screen).
 *
 * Fire-and-forget from client: `void fetch('/api/cfd/notify', ...).catch(() => {})`
 */

import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import {
  dispatchCFDShowOrder,
  dispatchCFDPaymentStarted,
  dispatchCFDTipPrompt,
  dispatchCFDReceiptSent,
} from '@/lib/socket-dispatch'

export const POST = withVenue(async (request: Request) => {
  try {
    const body = await request.json()
    const { event, locationId, payload } = body

    if (!event || !locationId || !payload) {
      return NextResponse.json({ error: 'Missing event, locationId, or payload' }, { status: 400 })
    }

    switch (event) {
      case 'show-order':
        dispatchCFDShowOrder(locationId, payload)
        break
      case 'payment-started':
        dispatchCFDPaymentStarted(locationId, payload)
        break
      case 'tip-prompt':
        dispatchCFDTipPrompt(locationId, payload)
        break
      case 'receipt-sent':
        dispatchCFDReceiptSent(locationId, payload)
        break
      default:
        return NextResponse.json({ error: `Unknown CFD event: ${event}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[CFD Notify] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
})
