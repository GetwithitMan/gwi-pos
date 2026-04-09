/**
 * CFD Notify — Lightweight API route for Customer-Facing Display events
 *
 * Client-side socket.emit() does NOT broadcast to other clients.
 * This route accepts CFD event payloads and dispatches them server-side
 * via emitToTerminal() (if cfdTerminalId provided) or emitToLocation() (fallback),
 * which properly broadcasts to the CFD screen.
 *
 * Fire-and-forget from client: `void fetch('/api/cfd/notify', ...).catch(err => console.warn('cfd notify failed:', err))`
 */

import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import {
  dispatchCFDShowOrder,
  dispatchCFDShowOrderDetail,
  dispatchCFDPaymentStarted,
  dispatchCFDTipPrompt,
  dispatchCFDTipSelected,
  dispatchCFDSignatureRequest,
  dispatchCFDProcessing,
  dispatchCFDApproved,
  dispatchCFDDeclined,
  dispatchCFDIdle,
  dispatchCFDReceiptSent,
} from '@/lib/socket-dispatch'
import { err, ok } from '@/lib/api-response'

export const POST = withVenue(withAuth(async (request: Request) => {
  try {
    const body = await request.json()
    const { event, locationId, payload, cfdTerminalId = null } = body

    if (!event || !locationId || !payload) {
      return err('Missing event, locationId, or payload')
    }

    switch (event) {
      case 'show-order':
        dispatchCFDShowOrder(locationId, cfdTerminalId, payload)
        break
      case 'show-order-detail':
        dispatchCFDShowOrderDetail(locationId, cfdTerminalId, payload)
        break
      case 'payment-started':
        dispatchCFDPaymentStarted(locationId, cfdTerminalId, payload)
        break
      case 'tip-prompt':
        dispatchCFDTipPrompt(locationId, cfdTerminalId, payload)
        break
      case 'tip-selected':
        await dispatchCFDTipSelected(locationId, cfdTerminalId, payload)
        break
      case 'signature-request':
        dispatchCFDSignatureRequest(locationId, cfdTerminalId, payload)
        break
      case 'processing':
        dispatchCFDProcessing(locationId, cfdTerminalId, payload)
        break
      case 'approved':
        dispatchCFDApproved(locationId, cfdTerminalId, payload)
        break
      case 'declined':
        dispatchCFDDeclined(locationId, cfdTerminalId, payload)
        break
      case 'idle':
        dispatchCFDIdle(locationId, cfdTerminalId)
        break
      case 'receipt-sent':
        dispatchCFDReceiptSent(locationId, cfdTerminalId, payload)
        break
      default:
        return err(`Unknown CFD event: ${event}`)
    }

    return ok({ ok: true })
  } catch (error) {
    console.error('[CFD Notify] Error:', error)
    return err('Internal error', 500)
  }
}))
