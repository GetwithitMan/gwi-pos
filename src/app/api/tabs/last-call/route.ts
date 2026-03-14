import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { getLocationId } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { roundToCents } from '@/lib/pricing'
import {
  dispatchOpenOrdersChanged,
  dispatchTabUpdated,
  dispatchTabClosed,
  dispatchTabStatusUpdate,
} from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'

/**
 * GET /api/tabs/last-call
 *
 * Preview: returns all open tabs that would be closed by Last Call,
 * including computed auto-gratuity amounts. Used by the confirmation dialog.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const employeeId = searchParams.get('employeeId')

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, 'manage_orders')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const settings = await getLocationSettings(locationId)
    const locSettings = parseSettings(settings)
    const barOps = locSettings.barOperations ?? { lastCallEnabled: true, lastCallAutoGratuityPercent: 20 }
    const autoGratuityPercent = barOps.lastCallAutoGratuityPercent || 20

    const openTabs = await db.order.findMany({
      where: {
        locationId,
        status: 'open',
        orderType: 'bar_tab',
      },
      include: {
        cards: {
          where: { deletedAt: null, status: 'authorized' },
          select: { id: true, cardLast4: true, cardType: true },
        },
        payments: {
          where: { status: 'completed' },
          select: { tipAmount: true },
        },
        employee: {
          select: { displayName: true, firstName: true, lastName: true },
        },
      },
      orderBy: { openedAt: 'desc' },
    })

    const tabs = openTabs.map(tab => {
      const subtotal = Number(tab.total) - Number(tab.tipTotal || 0)
      const existingTip = tab.payments.reduce((sum, p) => sum + (Number(p.tipAmount) || 0), 0)
      const hasTip = existingTip > 0
      const autoGratuity = hasTip ? 0 : roundToCents(subtotal * (autoGratuityPercent / 100))

      return {
        id: tab.id,
        tabName: tab.tabName || `Tab #${tab.orderNumber}`,
        orderNumber: tab.orderNumber,
        subtotal,
        hasCard: tab.cards.length > 0,
        cardLast4: tab.cards[0]?.cardLast4 || null,
        hasTip,
        autoGratuity,
        total: subtotal + autoGratuity,
        employee: tab.employee?.displayName || `${tab.employee?.firstName || ''} ${tab.employee?.lastName || ''}`.trim(),
      }
    })

    const totalAutoGratuity = roundToCents(tabs.reduce((sum, t) => sum + t.autoGratuity, 0))

    return NextResponse.json({
      data: {
        tabs,
        count: tabs.length,
        autoGratuityPercent,
        totalAutoGratuity,
      },
    })
  } catch (error) {
    console.error('[Last Call] Preview failed:', error)
    return NextResponse.json({ error: 'Failed to load Last Call preview' }, { status: 500 })
  }
})

/**
 * POST /api/tabs/last-call
 *
 * Batch-close all open bar tabs at end of night.
 * Tabs with pre-auth cards are closed via internal fetch to the close-tab route
 * (reusing the full 3-phase Datacap capture flow). Tabs without cards are closed
 * directly with auto-gratuity applied.
 *
 * Requires manage_orders permission (manager action).
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { employeeId } = body

    // ── Auth ──
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, 'manage_orders')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // ── Load settings ──
    const settings = await getLocationSettings(locationId)
    const locSettings = parseSettings(settings)
    const barOps = locSettings.barOperations ?? { lastCallEnabled: true, lastCallAutoGratuityPercent: 20 }

    if (!barOps.lastCallEnabled) {
      return NextResponse.json({ error: 'Last Call feature is disabled' }, { status: 400 })
    }

    const autoGratuityPercent = barOps.lastCallAutoGratuityPercent || 20

    // ── Fetch all open tabs ──
    const openTabs = await db.order.findMany({
      where: {
        locationId,
        status: 'open',
        orderType: 'bar_tab',
      },
      include: {
        items: {
          where: { deletedAt: null },
          select: { id: true, name: true, price: true, quantity: true },
        },
        cards: {
          where: { deletedAt: null, status: 'authorized' },
          select: {
            id: true,
            cardType: true,
            cardLast4: true,
            cardholderName: true,
            isDefault: true,
            status: true,
            authAmount: true,
            recordNo: true,
            readerId: true,
          },
        },
        payments: {
          where: { status: 'completed' },
          select: { id: true, tipAmount: true },
        },
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
      },
      orderBy: { openedAt: 'desc' },
    })

    if (openTabs.length === 0) {
      return NextResponse.json({
        data: { closed: 0, failed: [], autoGratuityTotal: 0, message: 'No open tabs to close' },
      })
    }

    // ── Process each tab ──
    let closedCount = 0
    let autoGratuityTotal = 0
    const failed: string[] = []

    for (const tab of openTabs) {
      const tabName = tab.tabName || `Tab #${tab.orderNumber}`

      try {
        // Skip tabs that already have a tip applied (payments with tip > 0)
        const existingTip = tab.payments.reduce(
          (sum, p) => sum + (Number(p.tipAmount) || 0),
          0
        )
        const hasTip = existingTip > 0

        // Compute subtotal (excluding existing tips)
        const subtotal = Number(tab.total) - Number(tab.tipTotal || 0)

        if (subtotal <= 0) {
          // Zero-balance tab — just close it
          await db.order.update({
            where: { id: tab.id },
            data: {
              status: 'paid',
              tabStatus: 'closed',
              paidAt: new Date(),
              version: { increment: 1 },
            },
          })

          void emitOrderEvent(locationId, tab.id, 'TAB_CLOSED', {
            employeeId: auth.employee.id,
            tipCents: 0,
            adjustedAmountCents: 0,
            batchClose: true,
          })

          void dispatchTabUpdated(locationId, { orderId: tab.id, status: 'closed' }).catch(() => {})
          dispatchTabClosed(locationId, { orderId: tab.id, total: 0, tipAmount: 0 })

          closedCount++
          continue
        }

        // ── Tab has a card: close via the close-tab route ──
        if (tab.cards.length > 0) {
          // Compute auto-gratuity amount for tabs without existing tip
          const tipAmountToApply = hasTip ? undefined : roundToCents(subtotal * (autoGratuityPercent / 100))

          // Build the internal request to close-tab
          // Use the origin from the incoming request for the internal fetch
          const origin = request.nextUrl.origin || `http://localhost:${process.env.PORT || 3000}`
          const closeUrl = `${origin}/api/orders/${tab.id}/close-tab`

          const closeRes = await fetch(closeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Forward venue slug for multi-tenant routing
              'x-venue-slug': request.headers.get('x-venue-slug') || '',
              // Forward cookies for auth
              'Cookie': request.headers.get('cookie') || '',
            },
            body: JSON.stringify({
              employeeId: auth.employee.id,
              tipMode: hasTip ? 'receipt' : 'included',
              tipAmount: tipAmountToApply,
              // Use the default card (first authorized)
              orderCardId: tab.cards.length === 1
                ? undefined
                : (tab.cards.find(c => c.isDefault)?.id || tab.cards[0]?.id),
            }),
          })

          const closeData = await closeRes.json()

          if (closeRes.ok && closeData.data?.success) {
            closedCount++
            if (!hasTip && tipAmountToApply) {
              autoGratuityTotal += tipAmountToApply
            }
          } else {
            const errorMsg = closeData.data?.error?.message || closeData.error || 'Capture failed'
            failed.push(`${tabName}: ${errorMsg}`)
          }
        } else {
          // ── Tab has NO card: close directly with auto-gratuity recorded ──
          const gratuityAmount = hasTip ? 0 : roundToCents(subtotal * (autoGratuityPercent / 100))
          const now = new Date()

          await db.$transaction(async (tx) => {
            // Apply auto-gratuity to the order total
            await tx.order.update({
              where: { id: tab.id },
              data: {
                status: 'paid',
                tabStatus: 'closed',
                tipTotal: hasTip ? undefined : gratuityAmount,
                total: hasTip ? undefined : subtotal + gratuityAmount,
                paidAt: now,
                version: { increment: 1 },
              },
            })

            // Create a cash payment record for tabs closed without a card
            await tx.payment.create({
              data: {
                orderId: tab.id,
                locationId,
                employeeId: auth.employee.id,
                paymentMethod: 'cash',
                amount: subtotal,
                tipAmount: gratuityAmount,
                totalAmount: subtotal + gratuityAmount,
                status: 'completed',
              },
            })
          })

          void emitOrderEvent(locationId, tab.id, 'TAB_CLOSED', {
            employeeId: auth.employee.id,
            tipCents: Math.round(gratuityAmount * 100),
            adjustedAmountCents: Math.round((subtotal + gratuityAmount) * 100),
            batchClose: true,
          })
          void emitOrderEvent(locationId, tab.id, 'ORDER_CLOSED', {
            closedStatus: 'paid',
          })

          void dispatchTabUpdated(locationId, { orderId: tab.id, status: 'closed' }).catch(() => {})
          dispatchTabStatusUpdate(locationId, { orderId: tab.id, status: 'closed' })
          dispatchTabClosed(locationId, {
            orderId: tab.id,
            total: subtotal + gratuityAmount,
            tipAmount: gratuityAmount,
          })

          closedCount++
          if (!hasTip) autoGratuityTotal += gratuityAmount
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        failed.push(`${tabName}: ${errorMsg}`)
        console.error(`[Last Call] Failed to close tab ${tab.id}:`, err)
      }
    }

    // ── Dispatch bulk refresh ──
    void dispatchOpenOrdersChanged(locationId, { trigger: 'paid' as any }, { async: true }).catch(() => {})

    return NextResponse.json({
      data: {
        closed: closedCount,
        total: openTabs.length,
        failed,
        autoGratuityTotal: roundToCents(autoGratuityTotal),
      },
    })
  } catch (error) {
    console.error('[Last Call] Batch tab close failed:', error)
    return NextResponse.json({ error: 'Failed to process Last Call' }, { status: 500 })
  }
})
