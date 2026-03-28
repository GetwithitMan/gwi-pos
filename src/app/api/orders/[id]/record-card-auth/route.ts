import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { normalizeCardholderName } from '@/lib/datacap/helpers'
import { recordTab, DuplicateTabError } from '@/lib/datacap/record-tab'
import { dispatchOpenOrdersChanged, dispatchTabUpdated } from '@/lib/socket-dispatch'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-record-card-auth')

/**
 * POST /api/orders/[id]/record-card-auth
 *
 * Android SDK handoff endpoint. After the Android device completes card
 * authorization via the Datacap dsiEMVAndroid SDK (SoftPOS / PAX), it
 * sends the auth result here so the POS can record the tab.
 *
 * This endpoint does NOT talk to Datacap -- the Android device already did.
 * It only records the result (OrderCard + Order update + events) using the
 * shared recordTab() function.
 *
 * SECURITY:
 *   - Employee validation: employeeId verified against location
 *   - Duplicate detection: recordTab() checks for existing open tabs with same recordNo
 *   - Amount validation: authAmount required and must be positive
 */
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))

    const {
      cardholderName: rawCardholderName,
      cardType,
      cardLast4,
      entryMethod,
      recordNo,
      authCode,
      authAmount,
      employeeId,
      transactionType,
      datacapResponseCode,
      datacapRefNo,
      datacapSequenceNo,
      cvm,
      aid,
      isPartialApproval,
      acqRefData,
      processData,
      tokenFrequency,
    } = body

    // Validate required fields
    if (!cardType || !cardLast4 || !recordNo || !authCode || !authAmount || !employeeId) {
      return err('Missing required fields: cardType, cardLast4, recordNo, authCode, authAmount, employeeId')
    }

    if (typeof authAmount !== 'number' || authAmount <= 0) {
      return err('authAmount must be a positive number')
    }

    // Fetch the order
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { location: { select: { id: true } } },
    })

    if (!order) {
      return notFound('Order not found')
    }

    const locationId = order.locationId

    // Validate employee belongs to this location
    const employee = await db.employee.findFirst({
      where: { id: employeeId, locationId, deletedAt: null },
      select: { id: true },
    })

    if (!employee) {
      return err('Employee not found at this location')
    }

    // Normalize cardholder name from chip format (SMITH/JOHN -> John Smith)
    const normalizedName = normalizeCardholderName(rawCardholderName)

    // Record the tab using shared logic
    try {
      const result = await recordTab({
        locationId,
        orderId,
        readerId: 'android-sdk',
        recordNo,
        cardType,
        cardLast4,
        cardholderName: normalizedName,
        authAmount: Number(authAmount),
        authCode,
        tabName: order.tabName || undefined,
        tableId: order.tableId,
        // Datacap metadata from Android SDK
        tokenFrequency: tokenFrequency || 'Recurring',
        acqRefData,
        processData,
        aid,
        cvm: cvm ? String(cvm) : undefined,
        refNo: datacapRefNo,
      })

      // Fire-and-forget socket dispatches so other terminals see the card auth
      void dispatchOpenOrdersChanged(locationId, { trigger: 'item_updated', orderId }).catch(err => log.warn({ err }, 'Background task failed'))
      void dispatchTabUpdated(locationId, { orderId }).catch(err => log.warn({ err }, 'Background task failed'))
      pushUpstream()

      return ok({
          approved: true,
          tabStatus: 'open',
          cardholderName: normalizedName,
          cardType,
          cardLast4,
          authAmount: Number(authAmount),
          recordNo,
          orderCardId: result.orderCardId,
          entryMethod: entryMethod || null,
          transactionType: transactionType || 'preauth',
          isPartialApproval: isPartialApproval || false,
          // Echo back Datacap metadata for Android-side reconciliation
          datacapResponseCode: datacapResponseCode || null,
          datacapRefNo: datacapRefNo || null,
          datacapSequenceNo: datacapSequenceNo || null,
          cvm: cvm || null,
          aid: aid || null,
        })
    } catch (err) {
      if (err instanceof DuplicateTabError) {
        // Gracefully return existing tab info instead of erroring
        return ok({
            tabStatus: 'existing_tab_found',
            existingTab: err.existingTab,
          })
      }
      throw err
    }
  } catch (error) {
    console.error('[record-card-auth] Failed to record card authorization:', error)
    return err('Failed to record card authorization', 500)
  }
}))
