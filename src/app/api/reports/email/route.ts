import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email-service'
import { withVenue } from '@/lib/with-venue'
import { formatCurrency } from '@/lib/utils'
import { getLocationDateRange } from '@/lib/timezone'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'

export const POST = withVenue(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { reportType, reportDate, recipientEmail, locationId } = body

    if (!recipientEmail || !locationId) {
      return NextResponse.json({ error: 'recipientEmail and locationId are required' }, { status: 400 })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(recipientEmail)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    // ── Generic report email path (from ReportExportBar) ─────────────────
    if (body.reportTitle && body.generatedData) {
      const { reportTitle, parameters, generatedData, recipientName, employeeId } = body

      // Validate permission
      if (employeeId) {
        const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_EXPORT)
        if (!auth.authorized) {
          return NextResponse.json({ error: auth.error }, { status: auth.status })
        }
      }

      const dateRange = parameters?.startDate && parameters?.endDate
        ? `${parameters.startDate} to ${parameters.endDate}`
        : 'All time'

      const { headers = [], rows = [], summary = [] } = generatedData || {}

      const summaryHTML = summary.length > 0
        ? `
          <div style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px; font-size: 16px; color: #374151;">Summary</h3>
            <table style="width: 100%; border-collapse: collapse;">
              ${(summary as { label: string; value: string }[]).map((s: { label: string; value: string }) => `
                <tr>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">${escapeHtml(s.label)}</td>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-weight: 600; text-align: right; font-size: 14px;">${escapeHtml(s.value)}</td>
                </tr>
              `).join('')}
            </table>
          </div>
        `
        : ''

      const tableHTML = rows.length > 0
        ? `
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="background: #f3f4f6;">
                ${(headers as string[]).map((h: string) => `
                  <th style="padding: 10px 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db;">${escapeHtml(h)}</th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
              ${(rows as string[][]).slice(0, 50).map((row: string[], i: number) => `
                <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#f9fafb'};">
                  ${row.map((cell: string) => `
                    <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(cell)}</td>
                  `).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${rows.length > 50 ? `<p style="padding: 12px; color: #6b7280; font-size: 13px;">Showing 50 of ${rows.length} rows. Export CSV for full data.</p>` : ''}
        `
        : '<p style="color: #9ca3af; padding: 24px; text-align: center;">No data available for this period.</p>'

      const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
          <div style="max-width: 700px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <div style="background: #1f2937; color: white; padding: 24px;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 600;">${escapeHtml(reportTitle)}</h1>
              <p style="margin: 8px 0 0; opacity: 0.8; font-size: 14px;">Period: ${escapeHtml(dateRange)}</p>
            </div>
            <div style="padding: 24px;">
              ${recipientName ? `<p style="margin: 0 0 16px; color: #374151;">Hi ${escapeHtml(recipientName)},</p>` : ''}
              <p style="margin: 0 0 20px; color: #6b7280; font-size: 14px;">
                Here is your ${escapeHtml(reportTitle.toLowerCase())} for ${escapeHtml(dateRange)}.
              </p>
              ${summaryHTML}
              ${tableHTML}
            </div>
            <div style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                Generated by GWI POS on ${new Date().toLocaleString()}
              </p>
            </div>
          </div>
        </body>
        </html>
      `

      // Fire-and-forget
      void sendEmail({
        to: recipientEmail,
        subject: `${reportTitle} - ${dateRange}`,
        html,
      }).catch(err => console.error('[reports/email] Failed to send generic report:', err))

      return NextResponse.json({ data: { sent: true } })
    }

    // ── Legacy daily report email path ───────────────────────────────────
    if (reportType !== 'daily') {
      return NextResponse.json({ error: 'Only daily report type is supported for legacy email path' }, { status: 400 })
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
        status: { in: [...REVENUE_ORDER_STATUSES] },
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
