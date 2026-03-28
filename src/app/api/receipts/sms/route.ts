import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { formatCurrency } from '@/lib/utils'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  credit: 'Credit',
  debit: 'Debit',
  gift_card: 'Gift Card',
  house_account: 'House Acct',
  loyalty_points: 'Loyalty',
  room_charge: 'Room Charge',
}

/**
 * Build a plain-text receipt suitable for SMS.
 * Keeps total under 1600 chars (Twilio concatenated SMS limit).
 */
function buildSmsReceipt(order: {
  orderNumber: number
  displayNumber?: string | null
  location: { name: string }
  items: Array<{
    name: string
    quantity: number
    itemTotal: unknown
    status: string
  }>
  payments: Array<{
    paymentMethod: string
    totalAmount: unknown
    cardLast4?: string | null
  }>
  subtotal: unknown
  taxTotal: unknown
  discountTotal: unknown
  tipTotal: unknown
  total: unknown
  paidAt: Date | null
}): string {
  const lines: string[] = []

  // Header
  lines.push(order.location.name)
  lines.push(`Order #${order.displayNumber || order.orderNumber}`)
  lines.push('---')

  // Items (truncate if too many to fit under limit)
  const activeItems = order.items.filter(i => i.status !== 'voided')
  const MAX_ITEMS = 20 // Safety cap to stay under SMS limit
  const itemsToShow = activeItems.slice(0, MAX_ITEMS)

  for (const item of itemsToShow) {
    const qty = item.quantity > 1 ? `${item.quantity}x ` : ''
    const comp = item.status === 'comped' ? ' (COMP)' : ''
    lines.push(`${qty}${item.name}${comp}  ${formatCurrency(Number(item.itemTotal))}`)
  }

  if (activeItems.length > MAX_ITEMS) {
    lines.push(`...and ${activeItems.length - MAX_ITEMS} more items`)
  }

  lines.push('---')

  // Totals
  lines.push(`Subtotal: ${formatCurrency(Number(order.subtotal))}`)

  const discount = Number(order.discountTotal)
  if (discount > 0) {
    lines.push(`Discount: -${formatCurrency(discount)}`)
  }

  lines.push(`Tax: ${formatCurrency(Number(order.taxTotal))}`)

  const tip = Number(order.tipTotal)
  if (tip > 0) {
    lines.push(`Tip: ${formatCurrency(tip)}`)
  }

  lines.push(`TOTAL: ${formatCurrency(Number(order.total))}`)

  // Payment methods
  if (order.payments.length > 0) {
    lines.push('---')
    for (const p of order.payments) {
      const label = PAYMENT_METHOD_LABELS[p.paymentMethod] || p.paymentMethod
      const card = p.cardLast4 ? ` ****${p.cardLast4}` : ''
      lines.push(`${label}${card}: ${formatCurrency(Number(p.totalAmount))}`)
    }
  }

  lines.push('')
  lines.push('Thank you!')

  const sms = lines.join('\n')

  // Truncate to 1600 chars if somehow still too long
  if (sms.length > 1600) {
    return sms.slice(0, 1597) + '...'
  }

  return sms
}

// POST - Send an SMS receipt for an order
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, phone, locationId } = body

    if (!orderId || !phone || !locationId) {
      return err('orderId, phone, and locationId are required')
    }

    // Basic phone validation (at least 10 digits)
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) {
      return err('Invalid phone number. Must be at least 10 digits.')
    }

    if (!isTwilioConfigured()) {
      return err('SMS service is not configured', 503)
    }

    // Fetch order with related data
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        location: {
          select: { name: true },
        },
        items: {
          where: { deletedAt: null },
        },
        payments: {
          where: { status: 'completed' },
        },
      },
    })

    if (!order) {
      return notFound('Order not found')
    }

    if (order.locationId !== locationId) {
      return forbidden('Order does not belong to this location')
    }

    const smsBody = buildSmsReceipt(order as any)

    // Fire-and-forget audit breadcrumb before attempting send
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: null,
        action: 'receipt_sms_attempted',
        entityType: 'order',
        entityId: orderId,
        details: { phone: digits.slice(-4), orderNumber: order.displayNumber || order.orderNumber },
      },
    }).catch(err => console.error('[receipt-sms] audit log (attempted) failed:', err))

    const result = await sendSMS({
      to: phone,
      body: smsBody,
    })

    if (!result.success) {
      void db.auditLog.create({
        data: {
          locationId,
          employeeId: null,
          action: 'receipt_sms_failed',
          entityType: 'order',
          entityId: orderId,
          details: { phone: digits.slice(-4), error: result.error || 'Unknown send failure' },
        },
      }).catch(err => console.error('[receipt-sms] audit log (failed) failed:', err))

      return err(result.error || 'Failed to send SMS', 500)
    }

    void db.auditLog.create({
      data: {
        locationId,
        employeeId: null,
        action: 'receipt_sms_sent',
        entityType: 'order',
        entityId: orderId,
        details: { phone: digits.slice(-4), messageSid: result.messageSid },
      },
    }).catch(err => console.error('[receipt-sms] audit log (sent) failed:', err))

    return ok({ success: true, messageSid: result.messageSid })
  } catch (error) {
    console.error('Failed to send SMS receipt:', error)
    return err('Failed to send SMS receipt', 500)
  }
}))
