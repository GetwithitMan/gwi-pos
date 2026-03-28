import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { sendEmail } from '@/lib/email-service'
import { generateInvoiceHTML } from '@/lib/invoice-generator'
import { mergeWithDefaults, DEFAULT_INVOICING } from '@/lib/settings'
import { emitToLocation } from '@/lib/socket-server'
import { err, notFound, ok } from '@/lib/api-response'

const BILLING_SOURCE = 'api' as never

// ─── POST /api/billing-invoices/[id]/send ──────────────────────────────────
// Send invoice via email. Sets status to 'sent' (pending), records sentAt.
export const POST = withVenue(withAuth('INVENTORY_MANAGE', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id } = await (ctx as any).params
    const locationId = ctx.auth.locationId

    const invoice = await db.invoice.findFirst({
      where: { id, locationId, deletedAt: null, source: BILLING_SOURCE },
      include: {
        vendor: { select: { id: true, name: true, email: true, phone: true, address: true } },
        lineItems: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!invoice) {
      return notFound('Invoice not found')
    }

    const status = String(invoice.status)
    if (status === 'paid' || status === 'voided') {
      return err(`Cannot send a ${status} invoice`)
    }

    const customerEmail = invoice.vendor?.email
    if (!customerEmail) {
      return err('Customer has no email address. Please update the customer info first.')
    }

    // Load invoicing settings for company info
    const location = await db.location.findFirst({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = mergeWithDefaults(location?.settings as any)
    const invSettings = settings.invoicing ?? DEFAULT_INVOICING

    // Generate HTML email body
    const invoiceData = {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status,
      customerName: invoice.vendor?.name ?? '',
      customerEmail: invoice.vendor?.email ?? '',
      customerAddress: invoice.vendor?.address ?? '',
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      subtotal: Number(invoice.subtotal),
      taxAmount: Number(invoice.taxAmount),
      total: Number(invoice.totalAmount),
      amountPaid: Number(invoice.shippingCost),
      balanceDue: Number(invoice.totalAmount) - Number(invoice.shippingCost),
      notes: invoice.notes?.split('\n---PAYMENTS---\n')[0] || '',
      lineItems: invoice.lineItems.map((li: any) => ({
        description: li.description,
        quantity: Number(li.quantity),
        unitPrice: Number(li.unitCost),
        total: Number(li.totalCost),
        taxable: li.unit === 'taxable',
      })),
    }

    const html = generateInvoiceHTML(invoiceData, invSettings)

    // Send email (fire-and-forget pattern with await for this critical action)
    const emailResult = await sendEmail({
      to: customerEmail,
      subject: `Invoice ${invoice.invoiceNumber} from ${invSettings.companyInfo.name || 'GWI POS'}`,
      html,
      from: invSettings.companyInfo.email || undefined,
    })

    if (!emailResult.success) {
      console.error('Failed to send invoice email:', emailResult.error)
      // Still mark as sent even if email fails — operator can resend
    }

    // Update invoice: status to sent (pending), record sentAt in deliveryDate
    await db.invoice.update({
      where: { id },
      data: {
        status: 'pending' as never, // 'pending' = sent
        deliveryDate: new Date(), // repurposed as sentAt
      },
    })

    void emitToLocation(locationId, 'invoices:changed', { locationId }).catch(console.error)

    return ok({
        success: true,
        emailSent: emailResult.success,
        emailError: emailResult.error || null,
        sentTo: customerEmail,
      })
  } catch (error) {
    console.error('Send billing invoice error:', error)
    return err('Failed to send invoice', 500)
  }
}))
