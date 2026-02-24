import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email-service'
import { withVenue } from '@/lib/with-venue'

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Payment method display labels
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  credit: 'Credit Card',
  debit: 'Debit Card',
  gift_card: 'Gift Card',
  house_account: 'House Account',
  loyalty_points: 'Loyalty Points',
}

// POST - Send an email receipt for an order
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, email, locationId } = body

    if (!orderId || !email || !locationId) {
      return NextResponse.json(
        { error: 'orderId, email, and locationId are required' },
        { status: 400 }
      )
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      )
    }

    // Fetch order with all related data
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        employee: {
          select: {
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        location: {
          select: {
            name: true,
            address: true,
            phone: true,
          },
        },
        items: {
          include: {
            modifiers: true,
          },
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
      return NextResponse.json({ error: 'Order does not belong to this location' }, { status: 403 })
    }

    const serverName = order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`
    const locationName = escapeHtml(order.location.name)
    const locationAddress = order.location.address ? escapeHtml(order.location.address) : ''
    const locationPhone = order.location.phone ? escapeHtml(order.location.phone) : ''

    // Build items HTML
    const activeItems = order.items.filter(item => item.status !== 'voided')
    const itemsHtml = activeItems.map(item => {
      const modifiersHtml = item.modifiers.length > 0
        ? item.modifiers.map(mod => {
            const preModText = mod.preModifier ? `${mod.preModifier} ` : ''
            const priceText = Number(mod.price) > 0 ? ` +${formatCurrency(Number(mod.price))}` : ''
            return `<div style="color:#6b7280;font-size:13px;padding-left:16px;">${escapeHtml(preModText)}${escapeHtml(mod.name)}${priceText}</div>`
          }).join('')
        : ''

      const compTag = item.status === 'comped' ? ' <span style="color:#dc2626;font-size:12px;">(COMP)</span>' : ''
      const qtyPrefix = item.quantity > 1 ? `${item.quantity}x ` : ''
      const priceStyle = item.status === 'comped' ? 'text-decoration:line-through;color:#9ca3af;' : ''

      return `
        <tr>
          <td style="padding:6px 0;vertical-align:top;">
            ${escapeHtml(qtyPrefix)}${escapeHtml(item.name)}${compTag}
            ${item.specialNotes ? `<div style="color:#6b7280;font-size:12px;font-style:italic;">Note: ${escapeHtml(item.specialNotes)}</div>` : ''}
            ${modifiersHtml}
          </td>
          <td style="padding:6px 0;text-align:right;vertical-align:top;white-space:nowrap;${priceStyle}">
            ${formatCurrency(Number(item.itemTotal))}
          </td>
        </tr>
      `
    }).join('')

    // Build payments HTML
    const paymentsHtml = order.payments.map(p => {
      const label = PAYMENT_METHOD_LABELS[p.paymentMethod] || p.paymentMethod
      const cardInfo = p.cardLast4 ? ` ****${p.cardLast4}` : ''
      return `
        <tr>
          <td style="padding:3px 0;color:#6b7280;">${escapeHtml(label)}${escapeHtml(cardInfo)}</td>
          <td style="padding:3px 0;text-align:right;">${formatCurrency(Number(p.totalAmount))}</td>
        </tr>
      `
    }).join('')

    const orderDate = new Date(order.createdAt)

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
        <div style="max-width:480px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">

          <!-- Header -->
          <div style="padding:24px;text-align:center;border-bottom:2px dashed #e5e7eb;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#1f2937;">${locationName}</h1>
            ${locationAddress ? `<p style="margin:4px 0 0;font-size:14px;color:#6b7280;">${locationAddress}</p>` : ''}
            ${locationPhone ? `<p style="margin:2px 0 0;font-size:14px;color:#6b7280;">${locationPhone}</p>` : ''}
          </div>

          <!-- Order Info -->
          <div style="padding:16px 24px;border-bottom:2px dashed #e5e7eb;font-size:14px;color:#374151;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:2px 0;">Order #:</td>
                <td style="padding:2px 0;text-align:right;font-weight:600;">${order.displayNumber || order.orderNumber}</td>
              </tr>
              <tr>
                <td style="padding:2px 0;">Date:</td>
                <td style="padding:2px 0;text-align:right;">${formatDate(orderDate)}</td>
              </tr>
              <tr>
                <td style="padding:2px 0;">Time:</td>
                <td style="padding:2px 0;text-align:right;">${formatTime(orderDate)}</td>
              </tr>
              <tr>
                <td style="padding:2px 0;">Server:</td>
                <td style="padding:2px 0;text-align:right;">${escapeHtml(serverName)}</td>
              </tr>
            </table>
          </div>

          <!-- Items -->
          <div style="padding:16px 24px;border-bottom:2px dashed #e5e7eb;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;color:#1f2937;">
              ${itemsHtml}
            </table>
          </div>

          <!-- Totals -->
          <div style="padding:16px 24px;border-bottom:2px dashed #e5e7eb;font-size:14px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:3px 0;color:#6b7280;">Subtotal:</td>
                <td style="padding:3px 0;text-align:right;">${formatCurrency(Number(order.subtotal))}</td>
              </tr>
              ${Number(order.discountTotal) > 0 ? `
              <tr>
                <td style="padding:3px 0;color:#059669;">Discount:</td>
                <td style="padding:3px 0;text-align:right;color:#059669;">-${formatCurrency(Number(order.discountTotal))}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding:3px 0;color:#6b7280;">Tax:</td>
                <td style="padding:3px 0;text-align:right;">${formatCurrency(Number(order.taxTotal))}</td>
              </tr>
              ${Number(order.tipTotal) > 0 ? `
              <tr>
                <td style="padding:3px 0;color:#6b7280;">Tip:</td>
                <td style="padding:3px 0;text-align:right;">${formatCurrency(Number(order.tipTotal))}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding:8px 0 3px;font-weight:700;font-size:18px;border-top:1px solid #e5e7eb;">TOTAL:</td>
                <td style="padding:8px 0 3px;text-align:right;font-weight:700;font-size:18px;border-top:1px solid #e5e7eb;">${formatCurrency(Number(order.total))}</td>
              </tr>
            </table>
          </div>

          <!-- Payment -->
          ${order.payments.length > 0 ? `
          <div style="padding:16px 24px;border-bottom:2px dashed #e5e7eb;font-size:14px;">
            <div style="font-weight:600;margin-bottom:8px;">Payment:</div>
            <table style="width:100%;border-collapse:collapse;">
              ${paymentsHtml}
            </table>
          </div>
          ` : ''}

          <!-- Footer -->
          <div style="padding:24px;text-align:center;">
            <p style="margin:0;font-size:16px;font-weight:600;color:#1f2937;">Thank you for your visit!</p>
            ${order.paidAt ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">Paid: ${formatDate(new Date(order.paidAt))} ${formatTime(new Date(order.paidAt))}</p>` : ''}
          </div>

        </div>
      </body>
      </html>
    `

    const result = await sendEmail({
      to: email,
      subject: `Receipt from ${order.location.name} - Order #${order.displayNumber || order.orderNumber}`,
      html,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send email' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data: { success: true, messageId: result.messageId } })
  } catch (error) {
    console.error('Failed to send email receipt:', error)
    return NextResponse.json(
      { error: 'Failed to send email receipt' },
      { status: 500 }
    )
  }
})
