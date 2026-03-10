import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'

const BILLING_SOURCE = 'api' as never

interface PaymentRecord {
  amount: number
  paymentMethod: 'cash' | 'card' | 'check' | 'transfer'
  reference: string | null
  notes: string | null
  date: string
  recordedBy: string | null
}

// ─── POST /api/billing-invoices/[id]/record-payment ─────────────────────────
// Record a payment against an invoice. Supports partial payments.
export const POST = withVenue(withAuth('INVENTORY_MANAGE', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id } = await (ctx as any).params
    const locationId = ctx.auth.locationId
    const body = await request.json()

    const {
      amount,
      paymentMethod,
      reference,
      notes: paymentNotes,
    } = body

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Payment amount must be greater than 0' }, { status: 400 })
    }

    if (!paymentMethod || !['cash', 'card', 'check', 'transfer'].includes(paymentMethod)) {
      return NextResponse.json(
        { error: 'Payment method must be cash, card, check, or transfer' },
        { status: 400 }
      )
    }

    const invoice = await db.invoice.findFirst({
      where: { id, locationId, deletedAt: null, source: BILLING_SOURCE },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const status = String(invoice.status)
    if (status === 'voided') {
      return NextResponse.json({ error: 'Cannot record payment on a voided invoice' }, { status: 400 })
    }
    if (status === 'draft') {
      return NextResponse.json({ error: 'Cannot record payment on a draft invoice. Send it first.' }, { status: 400 })
    }

    const totalAmount = Number(invoice.totalAmount)
    const previouslyPaid = Number(invoice.shippingCost) // shippingCost = amountPaid
    const balanceDue = totalAmount - previouslyPaid
    const paymentAmount = Math.min(Number(amount), balanceDue) // Don't overpay

    if (paymentAmount <= 0) {
      return NextResponse.json({ error: 'Invoice is already fully paid' }, { status: 400 })
    }

    const newTotalPaid = previouslyPaid + paymentAmount
    const newBalanceDue = totalAmount - newTotalPaid
    const isFullyPaid = newBalanceDue <= 0.01 // float tolerance

    // Build payment record
    const paymentRecord: PaymentRecord = {
      amount: paymentAmount,
      paymentMethod,
      reference: reference || null,
      notes: paymentNotes || null,
      date: new Date().toISOString(),
      recordedBy: ctx.auth.employeeId || null,
    }

    // Append payment record to notes field (after ---PAYMENTS--- marker)
    let currentNotes = invoice.notes || ''
    const paymentMarker = '\n---PAYMENTS---\n'
    let existingPayments: PaymentRecord[] = []

    if (currentNotes.includes(paymentMarker)) {
      const parts = currentNotes.split(paymentMarker)
      currentNotes = parts[0]
      try {
        existingPayments = JSON.parse(parts[1])
      } catch { /* ignore */ }
    }

    existingPayments.push(paymentRecord)
    const updatedNotes = currentNotes + paymentMarker + JSON.stringify(existingPayments)

    // Update invoice
    const updateData: Record<string, unknown> = {
      shippingCost: newTotalPaid, // shippingCost = amountPaid
      notes: updatedNotes,
    }

    if (isFullyPaid) {
      updateData.status = 'paid' as never
      updateData.paidDate = new Date()
    }

    await db.invoice.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({
      data: {
        success: true,
        paymentAmount,
        totalPaid: newTotalPaid,
        balanceDue: Math.max(0, newBalanceDue),
        isFullyPaid,
        paymentCount: existingPayments.length,
      },
    })
  } catch (error) {
    console.error('Record payment error:', error)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}))
