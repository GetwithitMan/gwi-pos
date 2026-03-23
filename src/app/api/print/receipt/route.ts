import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import { buildCustomerReceipt, type CustomerReceiptData } from '@/lib/escpos/customer-receipt'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { parseSettings, getPricingProgram } from '@/lib/settings'
import { calculateCardPrice } from '@/lib/pricing'
import type { PrintTemplateSettings } from '@/types/print'

/**
 * POST /api/print/receipt
 *
 * Print a customer receipt to the location's receipt printer via ESC/POS.
 *
 * Body: { orderId: string, printerId?: string }
 *   - orderId: required — the order to print a receipt for
 *   - printerId: optional — specific printer to use (defaults to the location's
 *     default receipt printer, or the first active receipt printer)
 *
 * Returns success/error — NOT fire-and-forget. Caller needs to know print result.
 */
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, printerId } = body

    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    // ── Load order with all receipt-relevant includes ──
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        employee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
            settings: true,
          },
        },
        table: {
          select: { id: true, name: true },
        },
        items: {
          where: { deletedAt: null },
          include: {
            modifiers: {
              where: { deletedAt: null },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        payments: {
          where: { status: 'completed', deletedAt: null },
          orderBy: { processedAt: 'asc' },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const locationId = order.locationId

    // ── Look up linked reservation (Reservation.orderId → this order) ──
    const linkedReservation = await db.reservation.findFirst({
      where: { orderId: orderId, deletedAt: null },
      select: { id: true, guestName: true, partySize: true },
    })

    // ── Resolve receipt printer ──
    let printer
    if (printerId) {
      // Use the specified printer
      printer = await db.printer.findFirst({
        where: { id: printerId, locationId, isActive: true, deletedAt: null },
      })
      if (!printer) {
        return NextResponse.json(
          { error: 'Specified printer not found or inactive' },
          { status: 400 }
        )
      }
    } else {
      // Find default receipt printer, then fallback to any active receipt printer
      printer = await db.printer.findFirst({
        where: { locationId, printerRole: 'receipt', isDefault: true, isActive: true, deletedAt: null },
      })
      if (!printer) {
        printer = await db.printer.findFirst({
          where: { locationId, printerRole: 'receipt', isActive: true, deletedAt: null },
        })
      }
    }

    if (!printer) {
      return NextResponse.json(
        { error: 'No receipt printer configured for this location' },
        { status: 400 }
      )
    }

    // ── Parse location settings for dual pricing / surcharge ──
    const locationSettings = parseSettings(order.location.settings)
    const dualPricing = locationSettings.dualPricing
    const dualPricingEnabled = dualPricing?.enabled
    const cashDiscountPercent = dualPricing?.cashDiscountPercent ?? 0
    const hasCardPayment = dualPricingEnabled && order.payments.some(
      (p) =>
        (p.paymentMethod === 'credit' && dualPricing?.applyToCredit) ||
        (p.paymentMethod === 'debit' && dualPricing?.applyToDebit)
    )
    const isDualCard = dualPricingEnabled && hasCardPayment

    // Tax: use stored split values (authoritative), fall back to recompute for legacy orders
    const activeItems = order.items.filter(
      (i) => !i.status || i.status === 'active'
    )
    const cashSubtotal =
      Math.round(activeItems.reduce((sum, i) => sum + Number(i.itemTotal), 0) * 100) / 100
    const discountTotal = Math.round(Number(order.discountTotal) * 100) / 100

    const storedTaxFromInclusive = Number(order.taxFromInclusive ?? 0)
    const storedTaxFromExclusive = Number(order.taxFromExclusive ?? 0)

    let subtotal: number
    let taxTotal: number
    let taxFromInclusive: number
    let taxFromExclusive: number

    if (isDualCard) {
      subtotal = calculateCardPrice(cashSubtotal, cashDiscountPercent)
      // For dual pricing card receipts, use stored order tax (already computed correctly)
      taxTotal = Math.round(Number(order.taxTotal) * 100) / 100
      taxFromInclusive = storedTaxFromInclusive
      taxFromExclusive = storedTaxFromExclusive
    } else {
      subtotal = cashSubtotal
      taxTotal = Math.round(Number(order.taxTotal) * 100) / 100
      taxFromInclusive = storedTaxFromInclusive
      taxFromExclusive = storedTaxFromExclusive
    }

    // For inclusive orders: total = subtotal - discount + exclusive tax only
    // For legacy/all-exclusive: taxFromExclusive = taxTotal, so same result
    const hasStoredSplit = taxFromInclusive > 0 || taxFromExclusive > 0
    const addedTax = hasStoredSplit ? taxFromExclusive : taxTotal
    const total = Math.round((subtotal - discountTotal + addedTax) * 100) / 100
    const tipTotal = Number(order.tipTotal)

    // Surcharge info
    const pp = getPricingProgram(locationSettings)
    const surchargeDisclosure =
      pp.enabled && pp.model === 'surcharge' && pp.surchargeDisclosure
        ? pp.surchargeDisclosure
        : null

    // ── Build employee display name ──
    const employeeName =
      order.employee.displayName ||
      `${order.employee.firstName} ${order.employee.lastName || ''}`.trim()

    // ── Build receipt data ──
    const receiptData: CustomerReceiptData = {
      order: {
        orderNumber: order.orderNumber,
        displayNumber: order.displayNumber,
        orderType: order.orderType,
        tabName: order.tabName,
        tableName: order.table?.name || null,
        guestCount: order.guestCount,
        employeeName,
        locationName: order.location.name || 'GWI POS',
        locationAddress: order.location.address,
        locationPhone: order.location.phone,
        createdAt: order.createdAt.toISOString(),
        paidAt: order.paidAt?.toISOString() || null,
        reservation: linkedReservation ? {
          guestName: linkedReservation.guestName,
          partySize: linkedReservation.partySize,
          confirmationId: linkedReservation.id.slice(-8).toUpperCase(),
        } : null,
      },
      items: activeItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: isDualCard
          ? calculateCardPrice(Number(item.price), cashDiscountPercent)
          : Number(item.price),
        modifiers: item.modifiers.map((m: any) => ({
          name: m.name,
          price: Number(m.price),
          preModifier: m.preModifier ?? null,
          isCustomEntry: m.isCustomEntry ?? false,
          isNoneSelection: m.isNoneSelection ?? false,
          noneShowOnReceipt: m.noneShowOnReceipt ?? false,
          customEntryName: m.customEntryName ?? null,
          swapTargetName: m.swapTargetName ?? null,
        })),
        specialNotes: item.specialNotes,
      })),
      payments: order.payments.map((p) => ({
        method: p.paymentMethod,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        totalAmount: Number(p.totalAmount),
        cardBrand: p.cardBrand,
        cardLast4: p.cardLast4,
        changeGiven: p.changeGiven ? Number(p.changeGiven) : null,
      })),
      totals: {
        subtotal,
        discount: discountTotal,
        tax: taxTotal,
        taxFromInclusive,
        taxFromExclusive,
        tipTotal,
        total,
        surchargeDisclosure,
      },
    }

    // ── Build ESC/POS buffer ──
    const printerSettings = printer.printSettings as Partial<PrintTemplateSettings> | null
    const buffer = buildCustomerReceipt(
      receiptData,
      printerSettings,
      printer.paperWidth,
      printer.printerType as 'thermal' | 'impact' | null
    )

    // ── Send to printer ──
    const result = await sendToPrinter(printer.ipAddress, printer.port, buffer)

    if (!result.success) {
      // Log the failed print job
      void db.printJob
        .create({
          data: {
            locationId,
            jobType: 'receipt',
            orderId,
            printerId: printer.id,
            status: 'failed',
            errorMessage: result.error || 'Unknown error',
            sentAt: new Date(),
          },
        })
        .catch(console.error)

      return NextResponse.json(
        { error: result.error || 'Failed to send to printer' },
        { status: 500 }
      )
    }

    // ── Log successful print job ──
    void db.printJob
      .create({
        data: {
          locationId,
          jobType: 'receipt',
          orderId,
          printerId: printer.id,
          status: 'sent',
          sentAt: new Date(),
        },
      })
      .catch(console.error)

    return NextResponse.json({
      data: {
        success: true,
        printerName: printer.name,
        orderId,
      },
    })
  } catch (error) {
    console.error('Failed to print receipt:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Print failed' },
      { status: 500 }
    )
  }
}))
