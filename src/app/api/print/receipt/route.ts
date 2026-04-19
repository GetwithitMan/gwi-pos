import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import { buildCustomerReceipt, type CustomerReceiptData } from '@/lib/escpos/customer-receipt'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { parseSettings, getPricingProgram } from '@/lib/settings'
import { calculateCardPrice, calculateDebitPrice } from '@/lib/pricing'
import type { PrintTemplateSettings } from '@/types/print'
import type { PricingProgram } from '@/lib/settings'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('print-receipt')

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
      return err('orderId is required')
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
            // Combo Pick N of M — hydrate selections for guest receipt rendering (Phase 7).
            comboSelections: {
              where: { deletedAt: null },
              orderBy: { sortIndex: 'asc' },
              select: {
                id: true,
                menuItemId: true,
                optionName: true,
                upchargeApplied: true,
                sortIndex: true,
              },
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
      return notFound('Order not found')
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
        return err('Specified printer not found or inactive')
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
      return err('No receipt printer configured for this location')
    }

    // ── Parse location settings — use canonical pricing program ──
    const locationSettings = parseSettings(order.location.settings)
    const snapshotPayment = order.payments.find((p: any) => p.pricingProgramSnapshot)
    const pp: PricingProgram = snapshotPayment?.pricingProgramSnapshot
      ? (typeof snapshotPayment.pricingProgramSnapshot === 'string'
        ? JSON.parse(snapshotPayment.pricingProgramSnapshot)
        : snapshotPayment.pricingProgramSnapshot) as PricingProgram
      : getPricingProgram(locationSettings)

    const isDualPricing = pp.enabled && (
      pp.model === 'dual_price' || pp.model === 'dual_price_pan_debit' || pp.model === 'cash_discount'
    )

    // Determine the applied tier from the first card payment
    const cardPayment = isDualPricing ? order.payments.find(p =>
      (p as any).pricingMode === 'card' ||
      (p as any).appliedPricingTier === 'credit' ||
      (p as any).appliedPricingTier === 'debit'
    ) : null
    const appliedTier = (
      (cardPayment as any)?.appliedPricingTier ||
      ((cardPayment as any)?.pricingMode === 'card' ? 'credit' : null)
    ) as 'credit' | 'debit' | null

    // Resolve markup percent based on which pricing tier was applied
    const markupPercent = (() => {
      if (!isDualPricing || !appliedTier) return 0
      if (appliedTier === 'debit') return pp.debitMarkupPercent ?? 0
      return pp.creditMarkupPercent ?? pp.cashDiscountPercent ?? 0
    })()

    const isDualCard = isDualPricing && !!cardPayment && markupPercent > 0

    const applyMarkup = (amount: number): number =>
      appliedTier === 'debit'
        ? calculateDebitPrice(amount, markupPercent)
        : calculateCardPrice(amount, markupPercent)

    // ─── Use STORED order values (never recalculate from items) ────────────
    const activeItems = order.items.filter(
      (i) => !i.status || i.status === 'active'
    )
    const cashSubtotal = Number(order.subtotal ?? 0)
    const discountTotal = Number(order.discountTotal ?? 0)
    const tipTotal = Number(order.tipTotal)

    // Tax: use stored values, respect tax-exempt status
    const isTaxExemptOrder = order.isTaxExempt ?? false
    const taxTotal = isTaxExemptOrder ? 0 : Number(order.taxTotal ?? 0)
    const taxFromInclusive = isTaxExemptOrder ? 0 : Number(order.taxFromInclusive ?? 0)
    const taxFromExclusive = isTaxExemptOrder ? 0 : Number(order.taxFromExclusive ?? 0)

    // Total: use stored value
    const total = Number(order.total ?? 0)

    // Subtotal for display — apply card markup if dual pricing
    const subtotal = isDualCard ? applyMarkup(cashSubtotal) : cashSubtotal

    // Surcharge info
    const surchargeDisclosure =
      pp.enabled && pp.model === 'surcharge' && pp.surchargeDisclosure
        ? pp.surchargeDisclosure
        : null

    // Cash discount / dual pricing disclosure
    const isDualPricingModel = pp.enabled && (
      pp.model === 'dual_price' || pp.model === 'dual_price_pan_debit' || pp.model === 'cash_discount'
    )
    const cashDiscountDisclosure = isDualPricingModel
      ? (pp.cashDiscountDisclosure || 'Posted prices reflect a non-cash adjustment. Cash payments receive a discount.')
      : null

    // ── Build employee display name ──
    const employeeName =
      order.employee?.displayName ||
      `${order.employee?.firstName ?? ''} ${order.employee?.lastName ?? ''}`.trim() || 'Unknown'

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
        pagerNumber: order.pagerNumber || null,
        fulfillmentMode: order.fulfillmentMode || null,
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
          ? applyMarkup(Number(item.price))
          : Number(item.price),
        modifiers: item.modifiers.map((m: any) => ({
          name: m.name,
          price: isDualCard
            ? applyMarkup(Number(m.price))
            : Number(m.price),
          depth: m.depth ?? 0,
          preModifier: m.preModifier ?? null,
          isCustomEntry: m.isCustomEntry ?? false,
          isNoneSelection: m.isNoneSelection ?? false,
          noneShowOnReceipt: m.noneShowOnReceipt ?? false,
          customEntryName: m.customEntryName ?? null,
          swapTargetName: m.swapTargetName ?? null,
        })),
        // Combo Pick N of M — pass customer picks through to the renderer. Upcharges
        // are never double-marked-up (they're already a line-item upcharge snapshot),
        // but we apply the same dual-pricing markup so displayed totals reconcile.
        comboSelections: Array.isArray((item as any).comboSelections)
          ? ((item as any).comboSelections as any[]).map((sel) => ({
              optionName: String(sel.optionName ?? ''),
              upchargeApplied: isDualCard
                ? applyMarkup(Number(sel.upchargeApplied ?? 0))
                : Number(sel.upchargeApplied ?? 0),
              sortIndex: Number(sel.sortIndex ?? 0),
              menuItemId: sel.menuItemId ? String(sel.menuItemId) : undefined,
            }))
          : undefined,
        specialNotes: item.specialNotes,
      })),
      payments: order.payments.map((p) => ({
        method: p.paymentMethod,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        totalAmount: Number(p.totalAmount),
        cardBrand: p.cardBrand,
        cardLast4: p.cardLast4,
        authCode: p.authCode,
        entryMethod: p.entryMethod,
        aid: p.aid,
        changeGiven: p.changeGiven ? Number(p.changeGiven) : null,
      })),
      totals: {
        subtotal,
        discount: discountTotal,
        tax: taxTotal,
        taxFromInclusive,
        taxFromExclusive,
        tipTotal,
        donationAmount: Number(order.donationAmount ?? 0),
        total,
        surchargeDisclosure,
        cashDiscountDisclosure,
        convenienceFee: Number(order.convenienceFee ?? 0),
        isTaxExempt: isTaxExemptOrder,
        taxExemptReason: order.taxExemptReason ?? null,
        // Dual pricing breakdown — only populated when dual pricing applies
        // Tax is NOT marked up (surcharge/markup is pre-tax per DP1 rule)
        ...(isDualCard ? {
          cardSubtotal: applyMarkup(cashSubtotal),
          cardTax: taxTotal,
          cardTotal: applyMarkup(cashSubtotal) + taxTotal - discountTotal + tipTotal,
          cashSubtotal,
          cashTax: taxTotal,
          cashTotal: total,
        } : {}),
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
        .catch(err => log.warn({ err }, 'Background task failed'))

      return err(result.error || 'Failed to send to printer', 500)
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
      .catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
        success: true,
        printerName: printer.name,
        orderId,
      })
  } catch (error) {
    console.error('Failed to print receipt:', error)
    return err(error instanceof Error ? error.message : 'Print failed', 500)
  }
}))
