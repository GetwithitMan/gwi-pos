import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { withVenue } from '@/lib/with-venue'

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  credit: 'Credit',
  debit: 'Debit',
  gift_card: 'Gift Card',
  house_account: 'House Acct',
  loyalty_points: 'Loyalty',
  room_charge: 'Room Charge',
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`
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
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, phone, locationId } = body

    if (!orderId || !phone || !locationId) {
      return NextResponse.json(
        { error: 'orderId, phone, and locationId are required' },
        { status: 400 }
      )
    }

    // Basic phone validation (at least 10 digits)
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) {
      return NextResponse.json(
        { error: 'Invalid phone number. Must be at least 10 digits.' },
        { status: 400 }
      )
    }

    if (!isTwilioConfigured()) {
      return NextResponse.json(
        { error: 'SMS service is not configured' },
        { status: 503 }
      )
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
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Order does not belong to this location' },
        { status: 403 }
      )
    }

    const smsBody = buildSmsReceipt(order as any)

    const result = await sendSMS({
      to: phone,
      body: smsBody,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send SMS' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      data: { success: true, messageSid: result.messageSid },
    })
  } catch (error) {
    console.error('Failed to send SMS receipt:', error)
    return NextResponse.json(
      { error: 'Failed to send SMS receipt' },
      { status: 500 }
    )
  }
})
