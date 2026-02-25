import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email-service'
import { withVenue } from '@/lib/with-venue'
import { formatCurrency } from '@/lib/utils'
import { getLocationDateRange } from '@/lib/timezone'

export const POST = withVenue(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { reportType, reportDate, recipientEmail, locationId } = body

    if (!recipientEmail || !locationId) {
      return NextResponse.json({ error: 'recipientEmail and locationId are required' }, { status: 400 })
    }

    if (reportType !== 'daily') {
      return NextResponse.json({ error: 'Only daily report type is supported' }, { status: 400 })
    }

    // Get location name
    const location = await db.location.findFirst({
      where: { id: locationId },
      select: { name: true },
    })

    const locationName = location?.name || 'Unknown Location'

    // Build date range for the report day using venue timezone
    const loc = await db.location.findFirst({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = loc?.timezone || 'America/New_York'
    const { startOfDay, endOfDay } = getLocationDateRange(timezone, reportDate)

    // Fetch key metrics
    const orders = await db.order.findMany({
      where: {
        locationId,
        deletedAt: null,
        status: 'paid',
        paidAt: { gte: startOfDay, lte: endOfDay },
      },
      select: {
        total: true,
        tipTotal: true,
        subtotal: true,
        taxTotal: true,
        discountTotal: true,
      },
    })

    const totalOrders = orders.length
    const netSales = orders.reduce((sum, o) => sum + Number(o.subtotal || 0), 0)
    const totalTax = orders.reduce((sum, o) => sum + Number(o.taxTotal || 0), 0)
    const totalTips = orders.reduce((sum, o) => sum + Number(o.tipTotal || 0), 0)
    const totalDiscounts = orders.reduce((sum, o) => sum + Number(o.discountTotal || 0), 0)
    const totalCollected = orders.reduce((sum, o) => sum + Number(o.total || 0), 0)
    const avgCheck = totalOrders > 0 ? netSales / totalOrders : 0

    // Void count
    const voidCount = await db.order.count({
      where: {
        locationId,
        status: 'voided',
        updatedAt: { gte: startOfDay, lte: endOfDay },
      },
    })

    const formattedDate = new Date(reportDate + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <div style="background: #1e40af; color: white; padding: 24px;">
            <h1 style="margin: 0; font-size: 24px;">Daily Sales Report</h1>
            <p style="margin: 8px 0 0 0; opacity: 0.9;">${locationName} — ${formattedDate}</p>
          </div>
          <div style="padding: 24px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px 0; font-weight: 600; color: #374151;">Net Sales</td>
                <td style="padding: 12px 0; text-align: right; font-size: 18px; font-weight: 700; color: #059669;">${formatCurrency(netSales)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px 0; color: #6b7280;">Total Orders</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600;">${totalOrders}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px 0; color: #6b7280;">Avg Check</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600;">${formatCurrency(avgCheck)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px 0; color: #6b7280;">Tax Collected</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600;">${formatCurrency(totalTax)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px 0; color: #6b7280;">Tips</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #059669;">${formatCurrency(totalTips)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px 0; color: #6b7280;">Discounts</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #dc2626;">${formatCurrency(totalDiscounts)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 12px 0; color: #6b7280;">Voids</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 600; color: #dc2626;">${voidCount}</td>
              </tr>
              <tr>
                <td style="padding: 16px 0 0 0; font-weight: 700; font-size: 16px; color: #111827;">Total Collected</td>
                <td style="padding: 16px 0 0 0; text-align: right; font-size: 20px; font-weight: 700; color: #1e40af;">${formatCurrency(totalCollected)}</td>
              </tr>
            </table>
          </div>
          <div style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; font-size: 12px; color: #6b7280;">
              Generated on ${new Date().toLocaleString()} — GWI POS
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    const result = await sendEmail({
      to: recipientEmail,
      subject: `Daily Report: ${locationName} — ${formattedDate}`,
      html,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to send email' }, { status: 500 })
    }

    return NextResponse.json({ data: { success: true, messageId: result.messageId } })
  } catch (error) {
    console.error('Email report error:', error)
    return NextResponse.json({ error: 'Failed to send report email' }, { status: 500 })
  }
})
