/**
 * Invoice HTML Generator
 *
 * Generates a professional HTML invoice suitable for email delivery or PDF printing.
 * Used by the billing invoice system (/api/billing-invoices/[id]/send).
 */

import type { InvoicingSettings } from '@/lib/settings'
import { formatCurrency } from '@/lib/utils'

export interface InvoiceData {
  id: string
  invoiceNumber: string
  status: string
  customerName: string
  customerEmail: string
  customerAddress: string
  invoiceDate: Date | string
  dueDate: Date | string | null
  subtotal: number
  taxAmount: number
  total: number
  amountPaid: number
  balanceDue: number
  notes: string
  lineItems: Array<{
    description: string | null
    quantity: number
    unitPrice: number
    total: number
    taxable: boolean
  }>
}

function formatDate(date: Date | string | null): string {
  if (!date) return 'N/A'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

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

/**
 * Generate a professional HTML invoice.
 */
export function generateInvoiceHTML(
  invoice: InvoiceData,
  settings: InvoicingSettings
): string {
  const company = settings.companyInfo
  const isPaid = invoice.status === 'paid'
  const isOverdue = !isPaid && invoice.dueDate && new Date(invoice.dueDate) < new Date()

  // Watermark overlay
  let watermark = ''
  if (isPaid) {
    watermark = `
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg);
                  font-size: 120px; font-weight: 900; color: rgba(34, 197, 94, 0.08);
                  letter-spacing: 12px; pointer-events: none; z-index: 0;">
        PAID
      </div>`
  } else if (isOverdue) {
    watermark = `
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg);
                  font-size: 100px; font-weight: 900; color: rgba(239, 68, 68, 0.08);
                  letter-spacing: 12px; pointer-events: none; z-index: 0;">
        OVERDUE
      </div>`
  }

  // Line items rows
  const lineItemRows = invoice.lineItems
    .map(
      (li) => `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; color: #374151;">
          ${escapeHtml(li.description || 'Item')}
          ${li.taxable ? '' : '<span style="color: #9ca3af; font-size: 12px; margin-left: 4px;">(non-taxable)</span>'}
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; text-align: center; color: #374151;">
          ${li.quantity}
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; text-align: right; color: #374151;">
          ${formatCurrency(li.unitPrice)}
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; text-align: right; font-weight: 500; color: #111827;">
          ${formatCurrency(li.total)}
        </td>
      </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f9fafb; color: #111827;">
  <div style="max-width: 800px; margin: 0 auto; padding: 32px 16px;">
    <div style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); position: relative;">
      ${watermark}

      <!-- Header -->
      <div style="padding: 32px; border-bottom: 2px solid #e5e7eb; position: relative; z-index: 1;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h1 style="margin: 0 0 4px 0; font-size: 28px; font-weight: 700; color: #111827;">INVOICE</h1>
            <p style="margin: 0; font-size: 16px; color: #6b7280; font-weight: 500;">
              ${escapeHtml(invoice.invoiceNumber)}
            </p>
          </div>
          <div style="text-align: right;">
            ${company.name ? `<p style="margin: 0 0 4px 0; font-size: 18px; font-weight: 600; color: #111827;">${escapeHtml(company.name)}</p>` : ''}
            ${company.address ? `<p style="margin: 0 0 2px 0; font-size: 13px; color: #6b7280;">${escapeHtml(company.address)}</p>` : ''}
            ${company.phone ? `<p style="margin: 0 0 2px 0; font-size: 13px; color: #6b7280;">${escapeHtml(company.phone)}</p>` : ''}
            ${company.email ? `<p style="margin: 0 0 2px 0; font-size: 13px; color: #6b7280;">${escapeHtml(company.email)}</p>` : ''}
            ${company.taxId ? `<p style="margin: 0; font-size: 12px; color: #9ca3af;">Tax ID: ${escapeHtml(company.taxId)}</p>` : ''}
          </div>
        </div>
      </div>

      <!-- Invoice Info + Customer -->
      <div style="padding: 24px 32px; display: flex; justify-content: space-between; position: relative; z-index: 1;">
        <div>
          <h3 style="margin: 0 0 8px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; font-weight: 600;">Bill To</h3>
          <p style="margin: 0 0 4px 0; font-size: 16px; font-weight: 600; color: #111827;">${escapeHtml(invoice.customerName)}</p>
          ${invoice.customerAddress ? `<p style="margin: 0 0 2px 0; font-size: 13px; color: #6b7280;">${escapeHtml(invoice.customerAddress)}</p>` : ''}
          ${invoice.customerEmail ? `<p style="margin: 0; font-size: 13px; color: #6b7280;">${escapeHtml(invoice.customerEmail)}</p>` : ''}
        </div>
        <div style="text-align: right;">
          <div style="margin-bottom: 8px;">
            <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; font-weight: 600;">Invoice Date</span>
            <p style="margin: 4px 0 0 0; font-size: 14px; color: #111827; font-weight: 500;">${formatDate(invoice.invoiceDate)}</p>
          </div>
          <div style="margin-bottom: 8px;">
            <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; font-weight: 600;">Due Date</span>
            <p style="margin: 4px 0 0 0; font-size: 14px; color: ${isOverdue ? '#dc2626' : '#111827'}; font-weight: ${isOverdue ? '700' : '500'};">
              ${formatDate(invoice.dueDate)}
              ${isOverdue ? ' (OVERDUE)' : ''}
            </p>
          </div>
          ${isPaid ? `
          <div>
            <span style="display: inline-block; padding: 4px 12px; background: #dcfce7; color: #166534; border-radius: 9999px; font-size: 12px; font-weight: 600;">
              PAID
            </span>
          </div>` : ''}
        </div>
      </div>

      <!-- Line Items Table -->
      <div style="padding: 0 32px; position: relative; z-index: 1;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="padding: 12px 16px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; font-weight: 600; border-bottom: 2px solid #e5e7eb;">
                Description
              </th>
              <th style="padding: 12px 16px; text-align: center; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; font-weight: 600; border-bottom: 2px solid #e5e7eb;">
                Qty
              </th>
              <th style="padding: 12px 16px; text-align: right; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; font-weight: 600; border-bottom: 2px solid #e5e7eb;">
                Unit Price
              </th>
              <th style="padding: 12px 16px; text-align: right; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; font-weight: 600; border-bottom: 2px solid #e5e7eb;">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            ${lineItemRows}
          </tbody>
        </table>
      </div>

      <!-- Totals -->
      <div style="padding: 24px 32px; position: relative; z-index: 1;">
        <div style="display: flex; justify-content: flex-end;">
          <div style="width: 280px;">
            <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
              <span style="color: #6b7280;">Subtotal</span>
              <span style="color: #111827; font-weight: 500;">${formatCurrency(invoice.subtotal)}</span>
            </div>
            ${invoice.taxAmount > 0 ? `
            <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
              <span style="color: #6b7280;">Tax</span>
              <span style="color: #111827; font-weight: 500;">${formatCurrency(invoice.taxAmount)}</span>
            </div>` : ''}
            <div style="display: flex; justify-content: space-between; padding: 12px 0 6px 0; font-size: 18px; border-top: 2px solid #e5e7eb; margin-top: 8px;">
              <span style="font-weight: 700; color: #111827;">Total</span>
              <span style="font-weight: 700; color: #111827;">${formatCurrency(invoice.total)}</span>
            </div>
            ${invoice.amountPaid > 0 ? `
            <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
              <span style="color: #059669;">Amount Paid</span>
              <span style="color: #059669; font-weight: 500;">-${formatCurrency(invoice.amountPaid)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0; font-size: 16px; border-top: 1px solid #e5e7eb; margin-top: 4px;">
              <span style="font-weight: 700; color: ${isOverdue ? '#dc2626' : '#111827'};">Balance Due</span>
              <span style="font-weight: 700; color: ${isOverdue ? '#dc2626' : '#111827'};">${formatCurrency(invoice.balanceDue)}</span>
            </div>` : ''}
          </div>
        </div>
      </div>

      <!-- Notes & Payment Terms -->
      ${invoice.notes || settings.defaultPaymentTermsDays ? `
      <div style="padding: 24px 32px; border-top: 1px solid #f3f4f6; position: relative; z-index: 1;">
        ${settings.defaultPaymentTermsDays ? `
        <div style="margin-bottom: 12px;">
          <h3 style="margin: 0 0 4px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; font-weight: 600;">Payment Terms</h3>
          <p style="margin: 0; font-size: 14px; color: #374151;">Net ${settings.defaultPaymentTermsDays} days</p>
        </div>` : ''}
        ${invoice.notes ? `
        <div>
          <h3 style="margin: 0 0 4px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; font-weight: 600;">Notes</h3>
          <p style="margin: 0; font-size: 14px; color: #374151; white-space: pre-wrap;">${escapeHtml(invoice.notes)}</p>
        </div>` : ''}
      </div>` : ''}

      <!-- Footer -->
      <div style="padding: 16px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; position: relative; z-index: 1;">
        <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">
          ${company.name ? `${escapeHtml(company.name)} | ` : ''}Invoice ${escapeHtml(invoice.invoiceNumber)}
          ${settings.lateFeePercent > 0 ? ` | A late fee of ${settings.lateFeePercent}% per month may apply to overdue balances.` : ''}
        </p>
      </div>
    </div>
  </div>
</body>
</html>`
}
